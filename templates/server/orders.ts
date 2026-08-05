/**
 * Which payment got which answer.
 *
 * Everything else this server could have stored is a question the chain answers:
 * balances, inventories, who owns the lantern. This file exists for the one
 * question it cannot. A Kei send has no memo, so a payment is named by its hash
 * and the order that redeems it arrives out of band — and nothing the game
 * writes back carries that hash. A mint says who got the lantern. A refund says
 * who got their money back. Neither says *which payment* it settled.
 *
 * So the chain cannot attribute an answer to a hash, and no amount of counting
 * makes it able to. Counting is the trap worth naming, because it looks like it
 * works: "this wallet has made three payments and been answered twice, so one is
 * still owed" is both true and useless. It cannot say *which* one, and a wallet
 * with two payments and one answer will let a repost of the answered payment
 * spend the unanswered one's credit — answering one hash twice and stranding the
 * other. Aggregates are not attribution.
 *
 * What attributes is a write-ahead log, and this is one:
 *
 *   1. read the issuer's frontier
 *   2. append an `intent` naming the hash, the plan, and that frontier — fsync
 *   3. write the block (mint or refund)
 *   4. append a `done` naming the hash and the outcome — fsync
 *
 * A wallet has one intent open at a time, because `settle` holds a mutex across
 * all four steps and refuses a wallet whose last intent is still open. That is
 * what makes step 3 recoverable *exactly*: while an intent is open, the only
 * blocks this issuer can write for that wallet are the one action that intent is
 * for. So a mint of the item to that address after that frontier is that
 * intent's delivery, and a Kei send to that address after it is that intent's
 * refund. Nothing else could have put them there.
 *
 * Step 3 is also the step that can fail without saying so. A node can refuse a
 * block — time out, drop the connection, lose the reply — and accept the same
 * block a moment later, so an error is not evidence and neither is a chain that
 * has nothing on it yet. "Not there" and "not there *yet*" read identically, and
 * treating the second as the first is how one payment gets two answers: the
 * intent is closed as void, the block lands, and the next post sees a player who
 * already owns the item and refunds what they paid for it.
 *
 * So absence has to be *made* true rather than observed. One account has one
 * chain and every block names the block it builds on, so a block signed against
 * an older frontier is dead the moment anything else occupies that slot — see
 * `fence`. Until that has been done, a failed action is indeterminate: the
 * intent stays open, the wallet is answered nothing further, and the next
 * attempt or the next restart resolves it against the chain.
 *
 * The chain's second job is to catch this file going missing. Answers written to
 * one address are countable on the issuer's chain even though they are not
 * attributable, so if this file holds fewer answers for an address than the
 * chain shows, records were lost — and every hash for that address that is not
 * on file becomes unanswerable rather than guessed at. That is a refusal, and it
 * is the point: a guess here either mints a second lantern or refunds one the
 * player kept.
 *
 * The same startup read of the chain is what makes a payment survive a restart
 * at all. `Kei.server()` collects everything waiting before this file gets to
 * attach a handler, so the arrival of a payment made while the game was down is
 * never announced to anyone. It is on the chain, though, which is where this
 * looks.
 *
 * That read is bounded by writing down where it got to. A `mark` names the last
 * block of the issuer's chain this file has read, and what was on it up to
 * there, so the next read starts from the mark rather than from the beginning —
 * and a game that has answered a million purchases starts as quickly as one
 * that has answered none. What a mark says was on the chain is counted off the
 * chain and never off the `done` lines beside it: a `done` that went missing is
 * exactly what that count is for, and deriving one from the other would make it
 * invisible.
 *
 * ## What is resident, and why that is a short list
 *
 * An answer is permanent — a payment from a year ago has to get its lantern
 * back rather than a second one — so the *record* of it is kept forever. That is
 * not the same as keeping it in memory forever, and this file used to do both:
 * every answer and every payment stayed in a `Map` for the life of the process
 * and was reloaded from the first line of the log at every restart. Steady-state
 * memory and startup time were proportional to lifetime sales, which is a shape
 * the developer inherits without having written it (SPEC §12).
 *
 * Three mechanisms replace that, and each one names what bounds it:
 *
 *   1. **An index, so history can be addressed** (`server/answers.ts`). Payment
 *      hash to the byte offset of its `done` line, on the disk. What is resident
 *      is `RESIDENT_ANSWERS` of them; a hash that is not is read back rather than
 *      treated as unanswered. Bounded by a constant.
 *   2. **A checkpoint, so a restart is not a re-read.** A `check` line folds
 *      everything before it — where the chain read had got to, the counts that
 *      still matter, the payments still owed an answer, the intents still open —
 *      so boot reads the log back to the last one rather than back to the start.
 *      Bounded by `checkpointBytes`.
 *   3. **Folding the per-wallet counts.** `onFile` and `onChain` exist to catch
 *      this file going missing, and a wallet whose two counts *agree* says the
 *      same thing whether it is remembered or forgotten: `0 <= 0` and `3 <= 3`
 *      are both "attributable". So a checkpoint keeps only the wallets whose
 *      counts disagree — an answer in flight, or a record genuinely lost — and
 *      drops the rest. Bounded by concurrent purchases plus real losses, and a
 *      deployment where that number is large is one where this file has already
 *      lost records and is refusing purchases about it.
 *
 * Two things are still allowed to grow, and both are named rather than hidden.
 * `outstanding` holds payments this game has received and not answered: that
 * entry is the only thing that lets such a payment still be redeemed, so it
 * cannot be dropped, and it is bounded by *unredeemed* payments rather than by
 * lifetime sales — at roughly 120 bytes each, a hundred thousand of them is
 * about 12MB. `clouded` holds wallets this game has refused for good, and
 * forgetting one is how a wallet gets answered twice; a game with many of them
 * is a game with a lost log.
 *
 * The log itself still grows, on the disk, and is never compacted — the index
 * addresses lines inside it, so moving them would strand every offset. That is
 * the intended shape: history belongs on the disk and this file's job was to
 * stop carrying all of it in memory.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'

import { KEI_DECIMALS, addressFromPublicKey, type Block, type Kei } from 'kei-transaction'

import type { LanternOutcome } from '../shared/game.js'
import { openAnswers } from './answers.js'

export interface Payment {
  /** The hash `kei.pay()` handed the player: the send block they signed. */
  hash: string
  from: string
  amount: number
}

/**
 * What settling a payment is about to do. `perform` writes the block; it runs
 * once, after the intent naming it is on the disk, and never again after a crash
 * without the chain being asked first whether it already ran.
 */
export interface Plan {
  kind: 'deliver' | 'refund'
  /** What the player is told, and what is written down under their hash. */
  outcome: LanternOutcome
  perform(): Promise<void>
}

export type Settled =
  | { status: 'answered'; outcome: LanternOutcome }
  /**
   * This payment has been answered and this game can no longer say with what,
   * because records for the wallet that made it are missing. Refuse; do not
   * guess. Both possible answers are in the player's own account history.
   */
  | { status: 'unattributable' }
  /**
   * An action for this wallet was submitted and its fate is not known: the node
   * neither confirmed it nor can be shown to have rejected it. Nothing has been
   * answered and nothing has been given up on. Ask again — the next attempt
   * resolves it if the node will talk, and so does a restart.
   */
  | { status: 'indeterminate' }

export interface Orders {
  /** Wait for one named payment to reach this game, or give up. */
  payment(hash: string, timeoutMs: number): Promise<Payment | undefined>
  /**
   * Answer one payment exactly once. A hash that already has an answer gets that
   * answer back, whether this process gave it or one that has since died did.
   */
  settle(payment: Payment, choose: () => Promise<Plan>): Promise<Settled>
  close(): void
}

export interface OrdersOptions {
  kei: Kei
  /** The item on sale. Mints of it are the deliveries this game has written. */
  item: string
  /** Where answers are appended. */
  path: string
  /**
   * How many blocks of the issuer's chain to ask the node for in one request.
   * Not a ceiling: a read that has not reached the block it is looking for asks
   * again for twice as many, so a long chain costs requests rather than a
   * refusal. What keeps it at one request is the `mark` — see `Mark`.
   */
  historyLimit?: number
  /**
   * How many bytes to append before folding them into a `check`. The checkpoint
   * is what a restart reads back to, so this is the knob that trades a longer
   * boot against more frequent fsyncs. Tests set it low to make the folding
   * visible; nothing else should need to.
   */
  checkpointBytes?: number
}

type Intent = { k: 'intent'; issuer: string; hash: string; address: string; plan: Plan['kind']; amount: number; since: string }
type Done = { k: 'done'; issuer: string; hash: string; address: string; amount: number; outcome: LanternOutcome }
type Void = { k: 'void'; issuer: string; hash: string }
/**
 * How far along the issuer's chain this file has read, and what it found there.
 *
 * The chain is read for two things — the answers this issuer has written to
 * each wallet, and the payments that reached it while nothing was listening —
 * and both are running totals over a chain that only grows at the end. So each
 * read starts where the last one stopped and this is the line that says where
 * that was.
 *
 * `answers` is counted off the blocks and not off the `done` lines in this same
 * file. That is the whole point: a `done` that went missing is what the count
 * is compared against, so a mark that derived one from the other would forget
 * the loss at the first restart and answer a payment that already has an answer.
 */
type Mark = {
  k: 'mark'
  issuer: string
  /** The newest block read. Everything up to and including it is counted here or in a mark before it. */
  frontier: string
  /** The mark this one continues from. `NOTHING` for a read that started at the first block of the chain. */
  since: string
  /** Answers found between the two, per address. */
  answers: Array<[string, number]>
  /** Payments found between the two that nothing has answered yet. */
  paid: Payment[]
}
/**
 * Everything before this line, in one line.
 *
 * The log is append-only and every restart used to read all of it, so startup
 * cost grew with lifetime sales. A checkpoint is the fold that stops it: it
 * states the running totals as of the moment it was written, and boot replays
 * only what came after. Nothing here is a new fact — every field is derivable
 * by reading the log from its first line, which is exactly what
 * `recountFromLog` does when the chain has to be recounted from its first block.
 *
 * What it deliberately does *not* carry is the answers themselves. Those are
 * addressed by `server/answers.ts` and read back one at a time, because a
 * checkpoint listing every answer ever given would be the original problem
 * written to disk once per checkpoint instead of once per boot.
 */
type Check = {
  k: 'check'
  issuer: string
  /** Where the chain read had reached. Replaces the marks folded into this line. */
  frontier: string
  /**
   * `[address, onFile, onChain]` for wallets whose two counts disagree, and only
   * those. A wallet that agrees with itself is dropped: `attributable` asks
   * whether the chain shows more answers than the file does, and `0 <= 0` is the
   * same answer as `3 <= 3`. Keeping the disagreements is keeping the losses.
   */
  counts: Array<[address: string, onFile: number, onChain: number]>
  /** Payments on file with nothing answering them yet. */
  outstanding: Payment[]
  /** Wallets refused for good, which no amount of forgetting makes answerable. */
  clouded: string[]
  /** Intents written and not closed. */
  intents: Intent[]
}
type Entry = Intent | Done | Void | Mark | Check

/** What an issuer block did for somebody, which is not which payment it did it for. */
interface Answer {
  kind: Plan['kind']
  address: string
}

/**
 * What the chain has to say about the one action an intent's window can hold.
 *
 * These are four different things and the bug is writing code that has three.
 * `absent` in particular is a claim about the future — that nothing can land
 * there any more — and it is only ever returned once that has been made true.
 */
type Evidence =
  | { state: 'found'; kind: Plan['kind'] }
  /** Nothing landed in that window and nothing still can: the slot after it is taken. */
  | { state: 'absent' }
  /** Two kinds of answer in one window. The invariant is broken; refuse rather than pick. */
  | { state: 'ambiguous' }
  /** The chain could not be read back to that frontier, so it said nothing either way. */
  | { state: 'unknown' }

/** A reading taken before the door is shut, where `pending` means "not there *yet*". */
type Reading = Evidence | { state: 'pending' }

/** The `link` of a block that links to nothing. */
const NOTHING = '0'.repeat(64)

/**
 * Answers held in memory. A hash past this is read off the disk, which is one
 * `pread` of the index and one of the line it names.
 *
 * It is a cache size and nothing rests on it: correctness is the same at 1 as
 * at a million, and the only thing that changes is how often a repost costs two
 * reads. Chosen so that the wallets currently playing fit comfortably.
 */
const RESIDENT_ANSWERS = 2_048

/** Bytes appended between checkpoints, and so roughly the most a restart reads back. */
const CHECKPOINT_BYTES = 256 * 1_024

/**
 * How far back to look for the last checkpoint before giving up and reading the
 * whole log. A checkpoint every `CHECKPOINT_EVERY` lines of a few hundred bytes
 * puts one every few hundred kilobytes, so this is a wide margin rather than a
 * limit anything is expected to reach.
 */
const CHECKPOINT_SEARCH_BYTES = 8 * 1_024 * 1_024

export async function openOrders(options: OrdersOptions): Promise<Orders> {
  const { kei, item, path } = options
  const node = kei.client.node
  const issuer = kei.address
  const historyLimit = options.historyLimit ?? 200
  const checkpointBytes = options.checkpointBytes ?? CHECKPOINT_BYTES

  /**
   * The answers this process has looked at lately, newest last.
   *
   * Every one of them is also on the disk — this is a cache in front of
   * `server/answers.ts`, never the only copy — so evicting the oldest costs a
   * read and nothing else. That is the whole difference from the `Map` this
   * replaced, which was the only copy and so could never evict anything.
   */
  const recent = new Map<string, { outcome: LanternOutcome; payment: Payment }>()
  /**
   * Payments with nothing answering them yet. Answering one moves it into
   * `recent` and the index, so this holds the owed rather than the settled.
   */
  const outstanding = new Map<string, Payment>()
  const waiting = new Map<string, Array<(payment: Payment) => void>>()

  /** Per address: answers on file, and answers on the chain. Equal, or records were lost. */
  const onFile = new Map<string, number>()
  const onChain = new Map<string, number>()
  /** Wallets whose answers can no longer be told apart. Never answered again by this process. */
  const clouded = new Set<string>()
  /** Wallets with an action whose fate is not known yet. Answered again once it is. */
  const unresolved = new Set<string>()
  /** Intents written and not yet closed, by payment hash. */
  const openIntents = new Map<string, Intent>()
  /** The last block of the issuer's chain that has been read. The first one, until a mark says otherwise. */
  let mark = NOTHING

  const bump = (counts: Map<string, number>, address: string): void => {
    counts.set(address, (counts.get(address) ?? 0) + 1)
  }

  // ------------------------------------------------------------------ the file

  mkdirSync(dirname(path), { recursive: true })

  /**
   * Where every answer is, for the answers this process is not holding.
   *
   * Opened before anything else reads the log, because the question every
   * replay below asks first is "has this hash been answered already?" and this
   * is what knows. Opening it replays whatever the log gained since the index
   * last committed, so from here on a miss means never answered rather than not
   * indexed yet.
   */
  const answers = openAnswers(path, function* (from: number) {
    for (const [entry, at] of entriesFrom(path, from)) {
      if (entry.issuer === issuer && entry.k === 'done') yield [entry.hash, at]
    }
  })

  /** The `done` line this hash got, read back off the disk. */
  const onDisk = (hash: string): { outcome: LanternOutcome; payment: Payment } | undefined => {
    const at = answers.offsetOf(hash)
    if (at === undefined) return undefined
    const entry = entryAt(path, at)
    if (entry?.k !== 'done' || entry.issuer !== issuer || entry.hash !== hash) {
      // The index pointed at something that is not this hash's answer, which
      // means the log it was built against is not the log beside it. Refusing
      // to guess is the same rule the rest of this file follows.
      throw new Error(
        `server/orders.ts: the index beside ${path} points at offset ${at} for payment ${hash.slice(0, 12)}…, and that ` +
          'is not where that answer is. Delete the ".index" file beside the log and start again — it is a cache of the ' +
          'log and is rebuilt from it, so nothing is lost by deleting it.',
      )
    }
    return { outcome: entry.outcome, payment: { hash, from: entry.address, amount: entry.amount } }
  }

  /** Hold an answer, dropping the oldest held once there are more than `RESIDENT_ANSWERS`. */
  const hold = (hash: string, held: { outcome: LanternOutcome; payment: Payment }): typeof held => {
    recent.delete(hash)
    recent.set(hash, held)
    // `Map` iterates in insertion order and `delete` above re-inserts on every
    // read, so the first key is the least recently used one.
    if (recent.size > RESIDENT_ANSWERS) recent.delete(first(recent.keys())!)
    return held
  }

  /** What this hash was answered with, from memory or from the disk. */
  const answerFor = (hash: string): LanternOutcome | undefined => {
    const held = recent.get(hash)
    if (held) return hold(hash, held).outcome
    const stored = onDisk(hash)
    return stored ? hold(hash, stored).outcome : undefined
  }

  /** The payment behind a hash, answered or not. */
  const paymentFor = (hash: string): Payment | undefined => {
    const owed = outstanding.get(hash)
    if (owed) return owed
    const held = recent.get(hash)
    if (held) return hold(hash, held).payment
    const stored = onDisk(hash)
    return stored ? hold(hash, stored).payment : undefined
  }

  const note = (payment: Payment): void => {
    if (outstanding.has(payment.hash) || recent.has(payment.hash)) return
    // A payment that already has an answer is not owed one, and re-noting it
    // would put it back among the payments this process is still carrying.
    if (answers.offsetOf(payment.hash) !== undefined) return
    outstanding.set(payment.hash, payment)
    for (const arrived of waiting.get(payment.hash) ?? []) arrived(payment)
    waiting.delete(payment.hash)
  }

  /** A payment that now has an answer: held rather than owed, and addressable on the disk. */
  const answered = (payment: Payment, outcome: LanternOutcome, at: number | undefined): void => {
    outstanding.delete(payment.hash)
    hold(payment.hash, { outcome, payment })
    if (at !== undefined) answers.record(payment.hash, at)
  }

  /**
   * Replay one stretch of the log into memory.
   *
   * Called from two places for two reasons: at boot from the last checkpoint,
   * which is the ordinary path, and from the first line by `recountFromLog`
   * when the chain has to be recounted from its first block and the folded
   * counts can no longer be trusted. Both are this same replay, which is the
   * point — a checkpoint is a fold of it and never a source of anything else.
   */
  const replay = (from: number): void => {
    for (const [entry, at] of entriesFrom(path, from)) {
      // Entries name their issuer, so two games sharing a directory — or one
      // game restarted on a new seed — do not read each other's answers.
      if (entry.issuer !== issuer) continue
      // A checkpoint reached by a replay that started before it is one whose
      // folded counts are exactly what that replay is rebuilding from scratch.
      if (entry.k === 'check') continue
      if (entry.k === 'mark') {
        // A read that started at the first block of the chain replaces what the
        // marks before it counted rather than adding to them.
        if (entry.since === NOTHING) onChain.clear()
        mark = entry.frontier
        for (const [address, count] of entry.answers) onChain.set(address, (onChain.get(address) ?? 0) + count)
        for (const payment of entry.paid) note(payment)
        continue
      }
      if (entry.k === 'intent') {
        openIntents.set(entry.hash, entry)
        continue
      }
      openIntents.delete(entry.hash)
      if (entry.k !== 'done') continue
      bump(onFile, entry.address)
      // A payment with an answer on file needs neither looking up on the node
      // nor carrying here: its own line says who made it and for how much, and
      // the index says where that line is.
      answered({ hash: entry.hash, from: entry.address, amount: entry.amount }, entry.outcome, at)
    }
  }

  /**
   * Boot from the last checkpoint rather than from the first line.
   *
   * This is the whole of the startup cost. Everything before that line was
   * folded into it when it was written, so what is read here is bounded by
   * `checkpointBytes` and not by how many lanterns this game has ever sold.
   */
  const resume = lastCheckpoint(path, issuer)
  if (resume.check) {
    mark = resume.check.frontier
    for (const [address, file, chain] of resume.check.counts) {
      if (file > 0) onFile.set(address, file)
      if (chain > 0) onChain.set(address, chain)
    }
    for (const payment of resume.check.outstanding) note(payment)
    for (const address of resume.check.clouded) clouded.add(address)
    for (const intent of resume.check.intents) openIntents.set(intent.hash, intent)
  }
  replay(resume.after)

  const file = openSync(path, 'a')
  /** Bytes of the log, so a `done` can say where it was written. Appends go to the end, always. */
  let logLength = sizeOf(path)
  /** Bytes written since the last `check`, which is what decides when the next one is due. */
  let sinceCheck = logLength - resume.after

  /** Where the line was written, so that a `done` can be found again without reading the log. */
  const append = (entry: Entry): number => {
    const at = logLength
    const line = `${JSON.stringify(entry)}\n`
    writeSync(file, line)
    // The crash that matters is the one between answering a player and that
    // player asking again, so the line reaches the disk before either can happen.
    fsyncSync(file)
    logLength += Buffer.byteLength(line)
    sinceCheck += Buffer.byteLength(line)
    return at
  }

  /**
   * Fold everything written so far into one line, if enough has been written to
   * be worth folding.
   *
   * The order is the whole of the crash story. The `check` reaches the disk
   * first and the index is told it covers the log second, so a crash between
   * them leaves a checkpoint that is true and an index that under-claims — and
   * an index that under-claims is repaired by replaying the log from where it
   * left off, which is what opening it does. The other order would leave an
   * index claiming to cover lines a crash took, and a hash whose answer is not
   * in an index that says it is complete reads as never answered.
   *
   * Called only from inside the mutex, so nothing is half-settled while the
   * counts it writes down are being read.
   */
  const checkpoint = (): void => {
    if (sinceCheck < checkpointBytes) return

    // Wallets whose two counts agree say the same thing forgotten as remembered
    // — `attributable` compares them, and `0 <= 0` is `3 <= 3`. What is kept is
    // every disagreement: an answer still in flight, or a record genuinely lost.
    const counts: Check['counts'] = []
    for (const address of new Set([...onFile.keys(), ...onChain.keys()])) {
      const file = onFile.get(address) ?? 0
      const chain = onChain.get(address) ?? 0
      if (file === chain) {
        onFile.delete(address)
        onChain.delete(address)
        continue
      }
      counts.push([address, file, chain])
    }

    append({
      k: 'check',
      issuer,
      frontier: mark,
      counts,
      outstanding: [...outstanding.values()],
      clouded: [...clouded],
      intents: [...openIntents.values()],
    })
    answers.commit(logLength)
    sinceCheck = 0
  }

  // ----------------------------------------------------------------- the chain

  // Attached before the chain is read, so a payment arriving between the two is
  // caught twice rather than missed once.
  const stop = kei.onPayment(async ({ from, amount, hash }) => {
    // `onPayment` reports the *receive* block this account wrote, which is not
    // the hash the payer holds. A receive names the send it collects in `link`.
    const receive = await node.blockInfo(hash)
    if (receive?.type !== 'state') return
    note({ hash: receive.link, from, amount })
  })

  // The chain up to here has been read and counted, and the mark says so on the
  // disk. Settling an intent below can put a block on it — `fence` does — and
  // that block is after the mark, so the next read is the one that counts it.
  // What must never happen is counting one of them twice.
  await catchUp()

  // -------------------------------------------------------- answers in flight

  // More than one intent can be open at once: an action nobody could resolve
  // leaves its own open and the game goes on serving other wallets. Each is
  // settled over its own window and told apart by the wallet it names. Two open
  // intents for *one* wallet is the case no window can separate, and it is
  // refused rather than guessed at.
  const perAddress = new Map<string, number>()
  for (const intent of openIntents.values()) bump(perAddress, intent.address)
  for (const intent of [...openIntents.values()]) {
    if ((perAddress.get(intent.address) ?? 0) > 1) {
      clouded.add(intent.address)
      continue
    }
    await closeIntent(intent)
  }

  // --------------------------------------------------------- asking the chain

  /**
   * The blocks written on top of `since`, newest first — an intent's window, or
   * everything the mark has not accounted for. `NOTHING` asks for the whole
   * chain, because the first block of one is built on nothing.
   *
   * The read asks for `historyLimit` blocks and doubles until `since` is in what
   * came back, so the length of the chain costs requests rather than a refusal.
   *
   * `undefined` is the answer that has to stay distinct from an empty window:
   * the block is not on this chain, so the window is not empty, it is
   * unreadable, and nothing can be claimed about it.
   */
  async function chainSince(since: string, frontier: string | undefined): Promise<Block[] | undefined> {
    let read = -1
    for (let limit = historyLimit; ; limit *= 2) {
      const history = await node.accountHistory(issuer, { limit })
      const at = history.findIndex((block) => builtOn(block, since))
      if (at !== -1) return history.slice(0, at + 1)
      // Nothing is built on it and it is the tip of the chain, so the window is
      // genuinely empty — which is not the same as nothing being able to arrive in it.
      if (frontier === since) return []
      const oldest = history[history.length - 1]
      // The first block of the chain came back and `since` is not on it, or the
      // node has stopped giving more however much is asked for.
      if (!oldest || /^0+$/.test(oldest.previous) || history.length === read) return undefined
      read = history.length
    }
  }

  /**
   * The balance a receive was built on, so that what arrived is the difference.
   *
   * The window came back in order, so the predecessor is the next entry along —
   * except at the oldest block in it, which is built on one the read stopped
   * before. That one is fetched by name rather than guessed at, because a guess
   * here is a refund for more than was paid.
   */
  async function balanceBefore(hash: string, predecessor: Block | undefined): Promise<bigint> {
    if (/^0+$/.test(hash)) return 0n
    if (predecessor) return BigInt(predecessor.balance)
    const block = await node.blockInfo(hash)
    if (!block) throw new Error(`server/orders.ts could not read block ${hash} of the issuer's own chain.`)
    return BigInt(block.balance)
  }

  /**
   * Read the chain from the mark to its tip, count what is on it, and move the
   * mark. One short read however long the chain is, because everything before
   * the mark was counted by the marks before it.
   *
   * The frontier is read first and nothing newer than it is counted, so a block
   * landing between the two reads is left for the next one rather than counted
   * here and marked as unread.
   */
  async function catchUp(): Promise<void> {
    const frontier = (await node.accountInfo(issuer))?.frontier
    if (frontier === undefined || frontier === mark) return

    let since = mark
    let window = await chainSince(since, frontier)
    if (!window) {
      // A mark this chain has never heard of says nothing about it — a mock node
      // is a new chain every run. Read it from the first block and count from
      // nothing, which is what the first run does anyway.
      since = NOTHING
      recountFromLog()
      window = await chainSince(NOTHING, frontier)
      if (!window) {
        throw new Error(
          `server/orders.ts asked the node for ${historyLimit} blocks of the issuer's chain and more, and did not ` +
            'reach the start of it. The first read needs all of it: a partial one cannot tell an answer this file ' +
            'lost from one written before the window began, and answering on that basis is how one payment gets ' +
            `answered twice. Every read after it starts at the last mark in ${path}, so keeping that file across a ` +
            'restart is what stops this happening again.',
        )
      }
    }

    const at = window.findIndex((block) => block.previous === frontier)
    const blocks = at === -1 ? window : window.slice(at + 1)

    // One pass, newest first, for the two things the chain is read for: how many
    // answers this issuer has written to each wallet, and which payments reached
    // it while nothing was listening.
    const counted = new Map<string, number>()
    const paid: Payment[] = []
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]
      if (!block) continue

      const answer = answerIn(block, item)
      if (answer) {
        bump(onChain, answer.address)
        bump(counted, answer.address)
        continue
      }

      if (block.type !== 'state') continue
      if (block.subtype !== 'receive' && block.subtype !== 'open') continue

      // Already known, from a mark before this one or from arriving live. It
      // still goes on this mark if nothing has answered it, because the mark is
      // about to move past the block that says it was ever made. One that has
      // been answered is on the disk and addressed by the index, so putting it
      // on the mark would be carrying it forward for nothing.
      const known = outstanding.get(block.link)
      if (known) {
        paid.push(known)
        continue
      }
      if (answers.offsetOf(block.link) !== undefined) continue

      const arrived = BigInt(block.balance) - (await balanceBefore(block.previous, blocks[index + 1]))
      if (arrived <= 0n) continue

      // An asset receive collects a token rather than Kei and cannot pay for
      // anything. `link` on one is an operation, not a send anybody signed.
      const send = await node.blockInfo(block.link)
      if (send?.type !== 'state' || send.subtype !== 'send') continue
      const payment = { hash: block.link, from: send.account, amount: keiFromRaw(arrived) }
      note(payment)
      paid.push(payment)
    }

    // Last, so that a crash anywhere above leaves the mark where it was and the
    // next read does this window again. Reading a block twice costs a moment;
    // marking one unread as read loses a payment.
    mark = frontier
    append({ k: 'mark', issuer, frontier, since, answers: [...counted], paid })
  }

  /** What is in one intent's window right now, which is not yet what will be. */
  async function read(intent: { since: string; address: string }): Promise<Reading> {
    let window: Block[] | undefined
    try {
      // Read before the history, so that a block landing between the two leaves
      // the history long rather than the frontier unaccounted for. It is the one
      // hash on the chain no `previous` field names, and an intent that got no
      // further than its own fsync recorded exactly it.
      const info = await node.accountInfo(issuer)
      window = await chainSince(intent.since, info?.frontier)
    } catch {
      return { state: 'unknown' }
    }
    // The read did not reach that frontier: it is not on the chain this game is
    // running against at all. The window cannot be looked at, so nothing is
    // claimed about it.
    if (!window) return { state: 'unknown' }

    const kinds = new Set<Plan['kind']>()
    for (const block of window) {
      const answer = answerIn(block, item)
      if (answer?.address === intent.address) kinds.add(answer.kind)
    }
    // Two kinds of answer inside one window is the one thing the invariant rules
    // out. If it happens the invariant is broken, and a refusal beats a guess.
    if (kinds.size > 1) return { state: 'ambiguous' }
    const only = first(kinds)
    return only ? { state: 'found', kind: only } : { state: 'pending' }
  }

  /**
   * Write a block that does nothing, so that one which might still be in flight
   * can never land.
   *
   * This is the whole answer to a submit that failed without saying whether it
   * failed. One account has one chain (SPEC §5.6.1) and every block names the
   * block it builds on, so a block already signed against some frontier is dead
   * the moment anything else occupies that slot — the node rejects it as a fork.
   * Any block written here is after the one in question was signed, so its slot
   * is at or before this one, and either way it is taken.
   *
   * A representative change to the representative already in place is the block
   * to do it with: it moves no Kei, mints nothing, and `answerIn` does not read
   * it as an answer to anybody. It is a door, not a decision.
   *
   * False if the node would not take it, in which case nothing is known and
   * nothing is claimed.
   */
  async function fence(): Promise<boolean> {
    try {
      await kei.client.submit((draft) => ({
        type: 'state',
        subtype: 'change',
        account: issuer,
        previous: draft.previous,
        representative: draft.representative,
        balance: draft.balance.toString(),
        link: NOTHING,
      }))
      return true
    } catch {
      return false
    }
  }

  /**
   * What an intent's action did, once the question can be answered for good.
   *
   * An empty window is the dangerous reading, because it is the one that looks
   * like proof and is not: a node can refuse a block and accept it a moment
   * later. So an empty window is fenced first and read again, and only a window
   * still empty behind a closed door counts as `absent`.
   */
  async function settled(intent: { since: string; address: string }): Promise<Evidence> {
    const seenNow = await read(intent)
    if (seenNow.state !== 'pending') return seenNow
    if (!(await fence())) return { state: 'unknown' }
    const afterwards = await read(intent)
    return afterwards.state === 'pending' ? { state: 'absent' } : afterwards
  }

  /**
   * Settle one intent against the chain and write the entry that closes it — or
   * leave it open, which is what everything short of an answer amounts to.
   *
   * The answer found here is not counted onto the chain's side of the ledger.
   * `catchUp` counts the blocks, this counts the entries, and one block counted
   * by both would read as a record this file never wrote.
   */
  async function closeIntent(intent: Intent): Promise<void> {
    const evidence = await settled(intent)

    if (evidence.state === 'found') {
      openIntents.delete(intent.hash)
      unresolved.delete(intent.address)
      const outcome = outcomeFor(evidence.kind, intent.amount, item)
      answers.set(intent.hash, outcome)
      bump(onFile, intent.address)
      note({ hash: intent.hash, from: intent.address, amount: intent.amount })
      append({ k: 'done', issuer, hash: intent.hash, address: intent.address, amount: intent.amount, outcome })
      return
    }

    if (evidence.state === 'absent') {
      // The action never landed and never can now. The payment is unanswered,
      // and closing the intent lets an ordinary repost answer it — which is
      // exactly what should happen.
      openIntents.delete(intent.hash)
      unresolved.delete(intent.address)
      append({ k: 'void', issuer, hash: intent.hash })
      return
    }

    // Nothing is written, because nothing is known. The intent stays open, and
    // with it the one thing that matters: no second answer can start for this
    // wallet while its first one might still be on its way.
    if (evidence.state === 'ambiguous') clouded.add(intent.address)
    else unresolved.add(intent.address)
  }

  /**
   * Try again to settle whatever this wallet has open, before answering it
   * anything. This is the path that gets a stuck wallet moving without a
   * restart: the node that would not answer a moment ago may answer now.
   */
  async function resolveOpen(address: string): Promise<void> {
    if (clouded.has(address)) return
    const mine = [...openIntents.values()].filter((intent) => intent.address === address)
    if (mine.length > 1) {
      clouded.add(address)
      return
    }
    const only = mine[0]
    if (only) await closeIntent(only)
  }

  /**
   * Whether a hash this file has never heard of can be treated as unanswered.
   *
   * Only if every answer the chain shows for this wallet is also on file. One
   * missing entry and any of its hashes could be the one that entry named, so
   * none of them can be answered — including, and this is the expensive one, by
   * being refunded.
   *
   * More on file than on the chain is not that, and is not a loss: it is an
   * answer written down since the last read of the chain, which is every answer
   * this process has given. The chain's count is never the larger of the two
   * unless a record went missing.
   */
  function attributable(address: string): boolean {
    return (onChain.get(address) ?? 0) <= (onFile.get(address) ?? 0)
  }

  // ------------------------------------------------------------- one at a time

  let queue: Promise<unknown> = Promise.resolve()
  const serially = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    async payment(hash, timeoutMs) {
      const already = seen.get(hash)
      if (already) return already

      return new Promise<Payment | undefined>((arrive) => {
        let timer: ReturnType<typeof setTimeout>
        const arrived = (payment: Payment): void => {
          clearTimeout(timer)
          arrive(payment)
        }
        timer = setTimeout(() => {
          const listeners = (waiting.get(hash) ?? []).filter((listener) => listener !== arrived)
          if (listeners.length === 0) waiting.delete(hash)
          else waiting.set(hash, listeners)
          arrive(undefined)
        }, timeoutMs)

        waiting.set(hash, [...(waiting.get(hash) ?? []), arrived])
      })
    },

    settle(payment, choose) {
      return serially<Settled>(async () => {
        // An action this wallet has open and unresolved is asked about again
        // here, on the chance the node has come back. It is the difference
        // between a wallet stuck until somebody restarts the game and a wallet
        // that unsticks itself the next time the player presses the button.
        await resolveOpen(payment.from)

        // And the chain is read forward from the mark, after that, because
        // settling can put a block on it. This is what makes the count below
        // the chain's rather than this process's memory of it — and it is a
        // read of the blocks written since the last purchase, not of the chain.
        // A node that will not answer leaves the mark where it is and is
        // answered for below.
        await catchUp().catch(() => undefined)

        const recorded = answers.get(payment.hash)
        if (recorded) return { status: 'answered', outcome: recorded }
        if (clouded.has(payment.from)) return { status: 'unattributable' }
        if (unresolved.has(payment.from)) return { status: 'indeterminate' }
        if (!attributable(payment.from)) return { status: 'unattributable' }

        // Inside the mutex, so the read this plan is chosen on — whether the
        // player already holds a lantern — cannot go stale before it is acted on.
        const plan = await choose()

        const info = await node.accountInfo(issuer)
        if (!info) {
          throw new Error('The issuer has no chain to write on, which cannot happen once it has issued its own assets.')
        }

        const intent: Intent = {
          k: 'intent',
          issuer,
          hash: payment.hash,
          address: payment.from,
          plan: plan.kind,
          amount: payment.amount,
          since: info.frontier,
        }
        append(intent)
        openIntents.set(intent.hash, intent)

        try {
          await plan.perform()
        } catch (error) {
          // The error says nothing on its own: a node that refuses a block can
          // accept it a moment afterwards. `closeIntent` asks the chain over
          // this intent's own window and shuts the door before believing an
          // empty one, so what the player is told is the chain's answer rather
          // than the exception's.
          await closeIntent(intent)
          const answered = answers.get(payment.hash)
          if (answered) return { status: 'answered', outcome: answered }
          if (clouded.has(payment.from)) return { status: 'unattributable' }
          if (openIntents.has(intent.hash)) return { status: 'indeterminate' }
          // Voided: nothing landed and nothing can now. The payment is untouched
          // and this hash can be posted again, so the failure is the answer.
          throw error
        }

        openIntents.delete(intent.hash)
        answers.set(payment.hash, plan.outcome)
        bump(onFile, payment.from)
        append({
          k: 'done',
          issuer,
          hash: payment.hash,
          address: payment.from,
          amount: payment.amount,
          outcome: plan.outcome,
        })
        return { status: 'answered', outcome: plan.outcome }
      })
    },

    close() {
      stop()
      closeSync(file)
    },
  }

}

/**
 * Whether this block is the one written on top of `since`, where `NOTHING` is
 * the start of the chain: the first block of an account names no predecessor,
 * so asking for everything after nothing asks for all of it.
 */
function builtOn(block: Block, since: string): boolean {
  return since === NOTHING ? /^0+$/.test(block.previous) : block.previous === since
}

/**
 * What an issuer block did for somebody else, which is the only trace an answer
 * leaves. A mint of the item is a delivery; any Kei send is a refund.
 *
 * That second rule is the one to keep in mind when editing this game. If it
 * gains another reason to send a player Kei, that send is counted here as an
 * answer, this file will look short of an entry, and real purchases from that
 * wallet will be refused as unattributable. Refusing is the safe direction — a
 * miscount here cannot pay anybody twice — but it is still a bug, and the fix is
 * to teach this function how to tell the two apart.
 */
function answerIn(block: Block, item: string): Answer | undefined {
  if (block.type === 'asset') {
    if (block.op.kind !== 'mint' || block.op.asset !== item) return undefined
    return { kind: 'deliver', address: block.op.to }
  }
  if (block.subtype !== 'send') return undefined
  return { kind: 'refund', address: addressFromPublicKey(block.link) }
}

function outcomeFor(kind: Plan['kind'], amount: number, item: string): LanternOutcome {
  return kind === 'deliver'
    ? { outcome: 'delivered', item }
    : { outcome: 'refunded', amount, reason: 'You already have a lantern.' }
}

function first<T>(values: Set<T>): T | undefined {
  for (const value of values) return value
  return undefined
}

function readEntries(path: string): Entry[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }

  const entries: Entry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      // A half-written last line is what a crash mid-append leaves behind, and
      // dropping it is always safe. A torn `done` leaves its `intent` open, and
      // the chain says what that intent did. A torn `intent` was never followed
      // by an action at all, because the action comes after the write that tore.
      const parsed = JSON.parse(line) as Entry
      if (looksLikeEntry(parsed)) entries.push(parsed)
    } catch {
      continue
    }
  }
  return entries
}

function looksLikeEntry(entry: Entry): boolean {
  if (typeof entry?.issuer !== 'string') return false
  if (entry.k === 'mark') {
    if (typeof entry.frontier !== 'string' || typeof entry.since !== 'string') return false
    return Array.isArray(entry.answers) && Array.isArray(entry.paid)
  }
  if (typeof entry.hash !== 'string') return false
  if (entry.k === 'void') return true
  if (typeof entry.address !== 'string' || typeof entry.amount !== 'number') return false
  if (entry.k === 'intent') return typeof entry.since === 'string' && (entry.plan === 'deliver' || entry.plan === 'refund')
  return entry.k === 'done' && typeof entry.outcome?.outcome === 'string'
}

/**
 * Raw Kei as the plain number `onPayment` reports, by the same route: decimal
 * string first, so a payment read off the chain and the same payment seen
 * arriving compare equal.
 */
function keiFromRaw(raw: bigint): number {
  const digits = raw.toString().padStart(KEI_DECIMALS + 1, '0')
  const whole = digits.slice(0, digits.length - KEI_DECIMALS)
  const fraction = digits.slice(digits.length - KEI_DECIMALS).replace(/0+$/, '')
  return Number(fraction === '' ? whole : `${whole}.${fraction}`)
}

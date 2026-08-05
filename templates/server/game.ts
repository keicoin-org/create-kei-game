/**
 * The whole backend.
 *
 * There is no database here. No `players` table, no `balances` table, no
 * `inventory` table, and no save file — those are questions the chain answers,
 * and asking it is `balanceOf`. What is left is what a game server is actually
 * for: deciding what a click is worth and what things cost.
 *
 * It holds the game's seed, which is why it cannot run in a browser. An issuer
 * seed in the client is a total compromise of your economy: anyone could mint
 * your currency without limit. `Kei.server()` refuses to start in a browser for
 * that reason, and there is no way to talk it round.
 */

import { Kei, isAddress, type ClaimBundle, type KeiNode } from 'kei-transaction'

import { CURRENCY, LANTERN, perClickFor, type Catalogue, type LanternOutcome } from '../shared/game.js'
import { openOrders } from './orders.js'

export interface GameOptions {
  seed: string
  node: KeiNode | string
  network?: 'mock' | 'testnet' | 'mainnet'
  /**
   * Where purchases are written down, before and after they are answered. See
   * `server/orders.ts`: it is the only thing this server keeps, and the only
   * thing that can say which payment got which answer. Losing it does not cost
   * money — nothing can be answered twice — but the wallets it held records for
   * can no longer buy, so back it up the way you would back up a database.
   */
  orders?: string
}

export interface Game {
  address: string
  catalogue(): Catalogue
  /** Pay for clicks. Returns the proof the player claims with. */
  earn(address: string, clicks: number, idempotencyKey?: string): Promise<ClaimBundle>
  /**
   * Deliver the lantern for one payment, named by the hash `kei.pay()` gave the
   * player. Calling it twice with the same hash returns the first answer rather
   * than delivering twice.
   */
  buyLantern(address: string, hash: string): Promise<LanternOutcome>
  close(): void
}

export class GameError extends Error {}

/**
 * What a wallet may be paid for, and what this process will mint at all.
 *
 * The browser counts its own clicks, because in single-player nothing else sees
 * them. That is a real trust hole and nothing here closes it — put a Colyseus
 * room in the middle and the clicks become observed. What these numbers do is
 * bound the damage until then, and there are two ceilings rather than one
 * because a wallet costs nothing to make: a per-wallet limit only ever limits a
 * wallet, and the attacker brings more wallets.
 *
 *   per wallet    25 clicks a second, at most 100 saved up. Fast for a finger,
 *                 slow for a script.
 *   per process   5 000 units a second, at most 50 000 saved up — a hundred
 *                 wallets clicking flat out. A fresh keypair does not reset it,
 *                 which is the only part of this a fresh keypair cannot defeat.
 *
 * At the process ceiling, draining a `maxSupply` of 1 000 000 000 takes about 55
 * hours of uninterrupted abuse. Raise these if your game is busier than that —
 * they are a bound on the blast radius, not a gameplay balance.
 */
export const EARN_LIMITS = {
  clicksPerSecond: 25,
  burstClicks: 100,
  /** Whole currency units, the same unit `PER_CLICK` is counted in. */
  unitsPerSecond: 5_000,
  burstUnits: 50_000,
  /** How many wallets' allowances are remembered. See `createEarnLimiter`. */
  wallets: 4_096,
} as const

export type EarnLimits = typeof EARN_LIMITS

/** What `admit` decided, and which ceiling decided it. */
export interface EarnAdmission {
  /** Clicks that may be paid for now, never more than were asked for. */
  clicks: number
  /** Which ceiling held this back, if either did. */
  ceiling: 'none' | 'wallet' | 'process'
}

export interface EarnLimiter {
  /**
   * How many of `clicks` may be paid for right now, having already taken the
   * allowance for them.
   *
   * Deciding and debiting happen together, in one synchronous call, before
   * anything is awaited and before anything is minted. A check separated from
   * its debit by an `await` is not a limit at all: the requests this exists to
   * stop arrive together, and every one of them would pass the check before the
   * first of them paid for it.
   */
  admit(address: string, clicks: number, now: number): EarnAdmission
  /** How many wallets are remembered. Never more than `limits.wallets`. */
  readonly remembered: number
}

/**
 * Tokens in hand, and when they were last brought up to date.
 *
 * `filledAt` advances by exactly the elapsed time that turned into whole tokens,
 * so the remainder of the division is credited to the next refill instead of
 * being dropped. Two refills in quick succession therefore grant what one refill
 * after the same delay would.
 */
interface Bucket {
  tokens: bigint
  filledAt: number
}

/**
 * Bring a bucket up to date and take up to `want` from it.
 *
 * An ordinary token bucket. The one line that matters is the `capacity` clamp:
 * what this replaces added `elapsed × rate` with nothing bounding it, so an idle
 * wallet banked allowance forever and a single request could spend an hour of
 * it. A wallet that posts once, waits an hour and posts again was owed 90 025
 * clicks. A bucket that is full is just full.
 */
function take(bucket: Bucket, want: bigint, rate: bigint, capacity: bigint, now: number): bigint {
  const gained = (BigInt(Math.max(0, now - bucket.filledAt)) * rate) / 1_000n
  if (gained > 0n) {
    bucket.tokens += gained
    bucket.filledAt += Number((gained * 1_000n) / rate)
  }
  if (bucket.tokens >= capacity) {
    bucket.tokens = capacity
    // Full, so the time not yet claimed is not owed. Discarding it here rather
    // than only capping the total is what stops an idle bucket accruing.
    bucket.filledAt = now
  }

  const taken = want < bucket.tokens ? want : bucket.tokens
  bucket.tokens -= taken
  return taken
}

export function createEarnLimiter(limits: EarnLimits = EARN_LIMITS): EarnLimiter {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new GameError(`EARN_LIMITS.${name} must be a whole number, one or more — got ${describe(value)}.`)
    }
  }

  /**
   * One bucket per wallet, held in least-recently-used order.
   *
   * A `Map` iterates in insertion order, so re-inserting on every touch leaves
   * the least recently used first and eviction is always the first key. What
   * this replaces was a `Map` nothing ever deleted from, written on every call
   * to an endpoint that needs no credentials — one entry per distinct string
   * ever posted, for the life of the process.
   *
   * Evicting a wallet hands it a full bucket the next time it asks: its
   * allowance resets. That is the trade, taken deliberately, and the process
   * ceiling below is what makes the reset worth nothing on its own.
   */
  const wallets = new Map<string, Bucket>()
  const clicksPerSecond = BigInt(limits.clicksPerSecond)
  const burstClicks = BigInt(limits.burstClicks)
  const unitsPerSecond = BigInt(limits.unitsPerSecond)
  const burstUnits = BigInt(limits.burstUnits)

  /**
   * The most one click can ever pay, and what the process budget is charged.
   *
   * What a click is actually worth depends on whether the player holds a
   * lantern, and that is a chain read — it cannot be known before the budget has
   * to be taken, because the budget has to be taken before anything is minted.
   * So the worst case is charged. A player without a lantern is charged twice
   * what they are paid, which makes the process ceiling conservative rather than
   * wrong, and at 5 000 units a second against one player's 50 the difference is
   * not observable.
   */
  const worstPerClick = BigInt(perClickFor(1))

  /** Lazily, so the first call sets the clock rather than 1970 filling it. */
  let budget: Bucket | undefined

  const bucketFor = (address: string, now: number): Bucket => {
    const known = wallets.get(address)
    if (known !== undefined) {
      wallets.delete(address)
      wallets.set(address, known)
      return known
    }

    const fresh: Bucket = { tokens: burstClicks, filledAt: now }
    wallets.set(address, fresh)
    while (wallets.size > limits.wallets) {
      const oldest = wallets.keys().next().value
      if (oldest === undefined) break
      wallets.delete(oldest)
    }
    return fresh
  }

  return {
    get remembered() {
      return wallets.size
    },

    admit(address, clicks, now) {
      const wallet = bucketFor(address, now)
      const asked = BigInt(clicks)
      const allowed = take(wallet, asked, clicksPerSecond, burstClicks, now)
      if (allowed === 0n) return { clicks: 0, ceiling: 'wallet' }

      budget ??= { tokens: burstUnits, filledAt: now }
      const paid = take(budget, allowed * worstPerClick, unitsPerSecond, burstUnits, now)

      // Whole clicks only. A click is not divisible, and paying for part of one
      // would credit a fraction of a coin the price list has no name for.
      const affordable = paid / worstPerClick
      const short = allowed - affordable
      if (short > 0n) {
        // Clicks the process would not pay for were never minted, so they go
        // back to the wallet rather than being quietly charged to it.
        wallet.tokens += short
        budget.tokens += paid - affordable * worstPerClick
      }

      if (affordable === 0n) return { clicks: 0, ceiling: 'process' }
      if (affordable < asked) return { clicks: Number(affordable), ceiling: short > 0n ? 'process' : 'wallet' }
      return { clicks: Number(affordable), ceiling: 'none' }
    },
  }
}

/** A value as it should read inside a sentence, so an empty string is visible. */
function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/**
 * How long to wait for a payment the player says they made. They are quicker
 * than the chain: `kei.pay()` returns as soon as the block is theirs, and this
 * side only knows about it once the node has told it and it has collected.
 */
const PAYMENT_WAIT_MS = 10_000

/** Which payment got which answer, so a restart is not amnesia. Kept out of git by `.gitignore`. */
const ORDERS_PATH = '.kei/orders.ndjson'
/** Keep successful claims alive briefly for retry safety after ambiguous transport. */
const EARN_IDEMPOTENCY_TTL_MS = 5 * 60_000

export async function startGame(options: GameOptions): Promise<Game> {
  const kei = await Kei.server({
    seed: options.seed,
    node: options.node,
    ...(options.network === undefined ? {} : { network: options.network }),
  })

  // Issuing an asset burns Kei — the one place in Kei where something is not
  // free, and what stops an infinite supply of worthless tokens. This game
  // issues two: the currency and the lantern. On a real network somebody funds
  // this address once; on a mock the faucet does it.
  const needed = 2 * 1_000 + 100
  if ((await kei.balance()) < needed) await kei.faucet(needed)

  // Idempotent: restarting this server returns the same currency rather than a
  // second one, because an asset's id is derived from the issuer and the ticker.
  const currency = await kei.token.issue({
    name: CURRENCY.name,
    symbol: CURRENCY.symbol,
    decimals: CURRENCY.decimals,
    maxSupply: CURRENCY.maxSupply,
    // Open, so players can trade with each other. 'issuer-only' or 'none' are
    // the other choices, and the chain enforces whichever you pick, forever.
    transfer: 'open',
    swap: 'off',
  })

  const lantern = await kei.items.create({
    name: LANTERN.name,
    description: LANTERN.description,
    supply: LANTERN.supply,
    transfer: 'open',
  })
  const lanterns = await kei.items.token(lantern.id)

  // Watches for payments, writes down what each one was answered with before it
  // is answered, and reads the issuer's own chain back so that neither survives
  // only in this process. It also serialises deliveries: two payments arriving
  // together cannot both read "this player has no lantern" and both mint one.
  const orders = await openOrders({
    kei,
    item: lantern.id,
    path: options.orders ?? ORDERS_PATH,
  })

  const limiter = createEarnLimiter()
  const earnInFlight = new Map<string, { address: string; clicks: number; promise: Promise<ClaimBundle> }>()
  const earnCompleted = new Map<string, { address: string; clicks: number; bundle: ClaimBundle; expiresAt: number }>()

  const pruneEarnCompleted = (): void => {
    const now = Date.now()
    for (const [idempotencyKey, value] of earnCompleted.entries()) {
      if (value.expiresAt <= now) earnCompleted.delete(idempotencyKey)
    }
  }

  const validateEarnKey = (idempotencyKey: string): string => {
    const key = idempotencyKey.trim()
    if (!key) throw new GameError('That earn request is missing an idempotency key.')
    if (!/^[A-Za-z0-9._-]+$/.test(key) || key.length > 64) {
      throw new GameError('The idempotency key must be letters, digits, ".", "_", or "-".')
    }
    return key
  }

  /**
   * The address and the click count, or a sentence saying what to send instead.
   *
   * Both arrive from an unauthenticated POST body (`server/main.ts`) as whatever
   * JSON happened to parse, so neither is a `string` or a `number` until it has
   * been looked at. `Infinity` in particular used to reach the arithmetic below
   * and come out as the whole allowance.
   */
  const validateEarn = (address: unknown, clicks: unknown): { address: string; clicks: number } => {
    if (!isAddress(address)) {
      throw new GameError(
        `earn() takes the Kei address of the player being paid — got ${describe(address)}. Send the address the player's own wallet reports.`,
      )
    }
    if (typeof clicks !== 'number' || !Number.isInteger(clicks) || clicks < 1) {
      throw new GameError(`earn() takes a whole number of clicks, one or more — got ${describe(clicks)}.`)
    }
    return { address, clicks }
  }

  const performEarn = async (address: string, clicks: number): Promise<ClaimBundle> => {
    // Everything that can refuse runs before anything that can mint, and the
    // allowance is spent here rather than after the chain read below — see
    // `admit`, which is where the reason for that ordering is written down.
    const admitted = limiter.admit(address, clicks, Date.now())
    if (admitted.clicks === 0) {
      throw new GameError(
        admitted.ceiling === 'process'
          ? `This game is already minting ${CURRENCY.symbol} as fast as it is willing to (${EARN_LIMITS.unitsPerSecond} units a second, in server/game.ts). Nothing was paid — send these clicks again in a moment.`
          : `That is faster than ${EARN_LIMITS.clicksPerSecond} clicks a second sustained, which is faster than a finger. Nothing was paid and the clicks are not lost — send them again in a moment.`,
      )
    }

    const owned = await lanterns.balanceOf(address)

    // One issuer block, and the player writes their own claim against it from
    // their own account. With one player this is a batch of one and the code
    // is identical Ã¢â‚¬â€ which is the useful part, because nothing has to be
    // rewritten when there are a thousand of them claiming at once. Minting
    // to each player in turn would instead make this account's chain a global
    // write lock, and the queue behind it would become the game.
    // Whole units, as an exact decimal string. `commit` takes a `number` too and
    // parses it by way of the float formatter, which is not what should decide
    // how much money is created — a BigInt cannot round and a string cannot be
    // reinterpreted on the way in.
    const units = BigInt(admitted.clicks) * BigInt(perClickFor(owned))
    const drop = await currency.commit([{ to: address, amount: units.toString() }])
    return drop.proofFor(address)
  }

  /**
   * Selling the lantern: the player signs the payment, the issuer signs the
   * delivery, and neither can sign for the other. There is no `charge(player, …)`
   * in this SDK and there never will be — a game cannot sign for a wallet it
   * does not hold the key to.
   *
   * The payment says who and how much. The hash says which, and the player is
   * the only one who has it when they make it, so quoting it is a claim only
   * they could make. Everything else here is checking that claim against what
   * this game watched arrive.
   */
  const deliver = async (address: string, hash: string): Promise<LanternOutcome> => {
    const payment = await orders.payment(hash, PAYMENT_WAIT_MS)
    if (!payment) {
      throw new GameError(
        `No payment ${hash.slice(0, 12)}… has reached this game. If you have only just paid, try again in a moment — nothing was delivered and nothing was kept.`,
      )
    }
    if (payment.from !== address) {
      throw new GameError('That payment was signed by a different wallet, and a payment buys for the wallet that made it.')
    }
    if (payment.amount < LANTERN.price) {
      throw new GameError(`That payment was ${payment.amount} Kei and the lantern costs ${LANTERN.price}.`)
    }

    // Waiting happens above, outside the queue, so one player's unarrived
    // payment cannot hold up everybody else's delivery. Everything below runs
    // one payment at a time, with the intent to answer this hash on the disk
    // before the block that answers it is written.
    const settled = await orders.settle(payment, async () => {
      // Already has one. The payment still arrived, so refund it rather than
      // keeping money for a thing that was not delivered.
      if ((await lanterns.balanceOf(address)) > 0) {
        return {
          kind: 'refund',
          outcome: { outcome: 'refunded', amount: payment.amount, reason: 'You already have a lantern.' },
          perform: async () => void (await kei.send(address, payment.amount)),
        }
      }
      return {
        kind: 'deliver',
        outcome: { outcome: 'delivered', item: lantern.id },
        perform: async () => void (await kei.items.mint(lantern.id, address)),
      }
    })

    // Answered, and this game cannot say with what: the entry naming this hash
    // is gone and the chain shows an answer it can no longer attribute. The one
    // thing that must not happen now is a guess. Delivering again would mint a
    // second lantern; refunding would hand back the price of one the player is
    // still holding.
    if (settled.status === 'unattributable') {
      throw new GameError(
        'This payment has already been answered — you were sent the lantern, or your Kei was refunded — and this game no longer has the record of which. Both are in your own account history. Nothing was taken, and nothing more will be.',
      )
    }

    // A lantern or a refund was sent to the chain and the chain has not said
    // whether it took it. The one thing that must not happen is a second try at
    // answering, because the first may still land — so nothing is answered until
    // it is known which. Nothing has been lost either: the payment stands and
    // this hash still redeems it.
    if (settled.status === 'indeterminate') {
      throw new GameError(
        'Your payment is still being settled: the game sent an answer and the network has not confirmed what happened to it. Nothing was taken and nothing was lost — try again in a moment, and you will get whichever answer the chain actually has.',
      )
    }
    return settled.outcome
  }

  /** Posts being served right now, so two tabs at once are one delivery. */
  const inFlight = new Map<string, Promise<LanternOutcome>>()

  return {
    address: kei.address,

    catalogue() {
      return {
        issuer: kei.address,
        network: kei.network,
        currency: { asset: currency.id, symbol: currency.symbol, decimals: currency.decimals },
        lantern: {
          asset: lantern.id,
          name: LANTERN.name,
          description: LANTERN.description,
          price: LANTERN.price,
        },
      }
    },

    async earn(rawAddress, rawClicks, idempotencyKey) {
      // Before the bookkeeping, not after it: a key must not be able to record an
      // order for an address that was never an address.
      const { address, clicks } = validateEarn(rawAddress, rawClicks)

      pruneEarnCompleted()
      const key = idempotencyKey === undefined ? undefined : validateEarnKey(idempotencyKey)
      if (key === undefined) return performEarn(address, clicks)

      const completed = earnCompleted.get(key)
      if (completed !== undefined) {
        if (completed.address !== address) {
          throw new GameError('That idempotency key was used from a different wallet.')
        }
        if (completed.clicks !== clicks) {
          throw new GameError('That idempotency key was already used for a different number of clicks.')
        }
        return completed.bundle
      }

      const inFlightOrder = earnInFlight.get(key)
      if (inFlightOrder !== undefined) {
        if (inFlightOrder.address !== address) {
          throw new GameError('That idempotency key is in use by a different wallet.')
        }
        if (inFlightOrder.clicks !== clicks) {
          throw new GameError('That idempotency key was already used for a different number of clicks.')
        }
        return inFlightOrder.promise
      }

      const order = (async () => {
        try {
          return await performEarn(address, clicks)
        } finally {
          earnInFlight.delete(key)
        }
      })()
      earnInFlight.set(key, { address, clicks, promise: order })

      const bundle = await order
      const now = Date.now()
      earnCompleted.set(key, {
        address,
        clicks,
        bundle,
        expiresAt: now + EARN_IDEMPOTENCY_TTL_MS,
      })
      return bundle

    },

    async buyLantern(address, hash) {
      if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash)) {
        throw new GameError('That is not a payment hash. Send the hash kei.pay() gave you.')
      }
      const paid = hash.toUpperCase()

      // Exactly once, and safe to retry: the first call for a hash owns the
      // delivery and every later one is handed its answer. A browser that loses
      // the response and posts again must not get a second lantern, and neither
      // must two tabs posting at the same moment. What survives a restart is in
      // `server/orders.ts`; this map only covers posts overlapping in time.
      const started = inFlight.get(paid)
      if (started) return started

      // A failure is not an answer — most often it means the payment has not
      // landed here yet — so it is not remembered and the player can try again.
      const order = deliver(address, paid).finally(() => {
        inFlight.delete(paid)
      })
      inFlight.set(paid, order)
      return order
    },

    close() {
      orders.close()
      kei.close()
    },
  }
}


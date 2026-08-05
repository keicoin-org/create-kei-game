/**
 * Every line of Kei in the browser, in one file, so it can be read in one sitting.
 *
 * The shape to notice: there is no call to this game's server asking what the
 * player's balance is, and there is no session. The browser holds a key, signs
 * its own blocks, and reads its own balances from the node. The server is asked
 * exactly one thing — pay me for these clicks — and it answers with a proof
 * rather than a number.
 *
 * The other thing to notice is what is missing. There is no save file. The
 * lantern is an item this wallet holds, so progress is restored by reading the
 * chain, and it is restored just as well in a different browser, or in a wallet
 * this game has never heard of.
 */

import { Kei, type ClaimBundle, type PlayerToken, type WalletSummary } from 'kei-transaction'

import { perClickFor, type Catalogue, type EarnOrder, type LanternOrder, type LanternOutcome } from '../shared/game.js'

export interface EconomyState {
  address: string
  /** False when the node or the game server could not be reached. */
  online: boolean
  /** The player's Kei — real money, and what the lantern is bought with. */
  kei: number
  /** The player's own currency, the one this game issues. */
  coins: number
  symbol: string
  /**
   * Clicks this browser has made and not yet been paid for: the ones still here
   * plus the ones sent and not yet confirmed.
   *
   * Derived rather than stored. The two halves are counted separately below,
   * because only one of them may be sent under a new key, and holding them in
   * one number is what made the same clicks payable twice.
   */
  unsaved: number
  saving: boolean
  perClick: number
  lanterns: number
  lanternPrice: number
  claiming: number
  /** One sentence for the player. Errors from the SDK arrive here verbatim. */
  message: string | null
}

export interface Economy {
  readonly state: EconomyState
  click(): void
  buyLantern(): Promise<void>
  on(listener: (state: EconomyState) => void): void
  close(): void
}

/** Bank after this many clicks, or this long, whichever comes first. */
const SAVE_AFTER_CLICKS = 20
const SAVE_AFTER_MS = 3_000

/**
 * A batch of clicks that has been sent, and has not been confirmed.
 *
 * The rule this file runs on, stated once here rather than re-derived at each
 * call site:
 *
 *   - Clicks that have **never been sent** live in `unsent`. They may go under a
 *     new key, because nothing anywhere has seen them.
 *   - Clicks that **have been sent** live here, and may only ever go again under
 *     the key they went under the first time. Whether they minted is not
 *     knowable from the browser — a request that timed out may well have been
 *     accepted — and the key is what makes asking again free.
 *   - The two sets are **disjoint**, and every transition moves clicks rather
 *     than copying them. Copying is precisely what turned "retry safely" into
 *     "credit twice": a batch restored to `unsent` while its order was still
 *     queued got paid for once under each key.
 */
interface Sent {
  /** The key this batch went under, and the only key it may ever go under. */
  key: string
  clicks: number
  /**
   * The proof the game answered with, held until the claim for it lands.
   *
   * Once the server has answered, the payout has happened and this is the only
   * copy of the entitlement in existence. So a claim that fails retries the
   * *claim*, not the earn — re-earning would be asking a second time for clicks
   * that have already been paid for.
   *
   * In memory only. A reload with a bundle outstanding loses it, and the payout
   * with it; that is a stated cost rather than a solved problem.
   */
  bundle?: ClaimBundle
}

/**
 * The game answered, and the answer was no.
 *
 * Distinct from every other failure in `save()`, and the distinction is the only
 * thing that makes putting clicks back safe. `server/game.ts` validates and
 * meters before it commits anything, and `server/main.ts` answers 4xx only for
 * that class of refusal — so a 4xx is evidence that this batch minted nothing
 * and its clicks are owed again. A timeout, a dropped connection, a 5xx or a
 * body that will not parse are the opposite: they say nothing at all about what
 * happened, and the order stands.
 */
class Refused extends Error {}

export async function connect(): Promise<Economy> {
  const listeners: Array<(state: EconomyState) => void> = []
  const state: EconomyState = {
    address: '',
    online: false,
    kei: 0,
    coins: 0,
    symbol: __CURRENCY_SYMBOL_LITERAL__,
    unsaved: 0,
    saving: false,
    perClick: 1,
    lanterns: 0,
    lanternPrice: 0,
    claiming: 0,
    message: null,
  }

  /** Clicks that have never left this browser. */
  let unsent = 0
  /** Clicks that have. See `Sent`. */
  let sent: Sent | undefined

  const notify = (): void => {
    for (const listener of listeners) listener(state)
  }
  const changed = (): void => {
    // Recomputed here rather than kept as a third counter, so the number shown
    // to the player and the two the retry logic runs on cannot drift apart.
    state.unsaved = unsent + (sent?.clicks ?? 0)
    notify()
  }
  const say = (error: unknown): void => {
    // Every error this SDK raises is a sentence that states its own fix, so it
    // is shown as written rather than replaced with "something went wrong".
    state.message = error instanceof Error ? error.message : String(error)
    changed()
  }

  let catalogue: Catalogue
  let kei: Kei
  let currency: PlayerToken
  try {
    catalogue = (await (await fetch('/game/catalogue')).json()) as Catalogue

    // The wallet. Created on first visit, saved in this browser, and reused
    // forever after. No signup, no API key, no extension.
    kei = await Kei.start({
      node: `${location.origin}/rpc`,
      network: catalogue.network as 'mock' | 'testnet',
    })
    currency = await kei.token(catalogue.currency.asset)
  } catch (error) {
    // Practice mode: clicking still works and says plainly that nothing is
    // landing. A game that shows a blank screen because one fetch failed is
    // worse than one that keeps going and tells you why.
    state.message =
      error instanceof Error && !/Failed to fetch|NetworkError/.test(error.message)
        ? error.message
        : 'No game server here — clicks are not being paid. Start one with: bun run dev'
    return offline(state, listeners, notify)
  }

  state.address = kei.address
  state.online = true
  state.symbol = catalogue.currency.symbol
  state.lanternPrice = catalogue.lantern.price

  // On a mock chain a new player funds themselves, which is what a testnet
  // faucet is for. On mainnet this is the one human step there is.
  if ((await kei.balance()) === 0 && catalogue.network !== 'mainnet') {
    await kei.faucet().catch(() => undefined)
  }

  // Everything the player owns, read from the chain, pushed here on change.
  const apply = (summary: WalletSummary): void => {
    state.kei = summary.kei
    state.coins = summary.tokens.find((token) => token.asset === catalogue.currency.asset)?.amount ?? 0
    state.lanterns = summary.items.find((item) => item.asset === catalogue.lantern.asset)?.count ?? 0
    state.perClick = perClickFor(state.lanterns)
    state.claiming = summary.pending.length
    changed()
  }

  apply(await kei.wallet.summary())
  kei.wallet.on('change', apply)
  kei.on('error', say)

  // ------------------------------------------------------------------- saving

  let timer: ReturnType<typeof setTimeout> | undefined

  /** One per batch, minted before the first attempt and reused by every retry. */
  const newKey = (): string =>
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 2_000_000_000).toString(36)}`

  /** Ask the game to pay for one batch, and hand back the proof it answers with. */
  const ask = async (order: Sent): Promise<ClaimBundle> => {
    const response = await fetch('/game/earn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        address: kei.address,
        clicks: order.clicks,
        idempotencyKey: order.key,
      } satisfies EarnOrder),
    })

    // Read before judged, because a body that will not parse is not an answer: a
    // proxy's error page arrives here indistinguishably from a game that never
    // saw the request, and both belong on the ambiguous path.
    const body = (await response.json()) as { bundle?: ClaimBundle; error?: string }

    // 4xx is the game refusing, which it only does before it commits anything.
    // Anything else that goes wrong is not evidence of anything. See `Refused`.
    if (response.status >= 400 && response.status < 500 && body.error) throw new Refused(body.error)
    if (body.error) throw new Error(body.error)
    if (!body.bundle) {
      throw new Error(
        'The game server answered without a proof and without an error. Nothing has been claimed; this batch will be sent again under the same key, so it can only ever be paid for once.',
      )
    }
    return body.bundle
  }

  const save = async (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (state.saving) return

    if (sent === undefined) {
      if (unsent <= 0) return
      // Moved, not copied. From here these clicks exist in exactly one place,
      // which is what stops them being paid for under two keys.
      sent = { key: newKey(), clicks: unsent }
      unsent = 0
    }
    const order = sent

    state.saving = true
    changed()
    try {
      // Skipped by a retry that already holds its proof: for that batch the
      // payout has happened and what failed was collecting it.
      order.bundle ??= await ask(order)

      // From here the game is not involved. The bundle is an entitlement, and
      // the claim that collects it is written by this wallet, from this account,
      // in parallel with every other player claiming against the same root.
      await kei.claims.add(order.bundle)
      sent = undefined
      state.message = null
    } catch (error) {
      if (error instanceof Refused) {
        // The one failure that is evidence. The game decided, and it decided
        // before committing anything, so this batch was not paid for and its
        // clicks go back to being unsent.
        sent = undefined
        unsent += order.clicks
      }
      // Every other failure says nothing about whether the payout landed, so
      // nothing moves: the order keeps its key, its count, and whatever proof it
      // has. Asking again under the same key is free.
      say(error)
    } finally {
      state.saving = false
      // Anything still owed schedules its own next attempt. Without this a batch
      // left outstanding waits for the player to click again, and a player who
      // has stopped clicking is never paid for the ones they already made.
      if (sent !== undefined || unsent > 0) timer ??= setTimeout(() => void save(), SAVE_AFTER_MS)
      changed()
    }
  }

  return {
    state,

    click() {
      // `unsent` rather than `state.unsaved`: a batch already in flight must not
      // make the next click flush, or the flush would find that batch and send it
      // again while these clicks sit waiting behind it.
      unsent++
      if (unsent >= SAVE_AFTER_CLICKS) void save()
      else timer ??= setTimeout(() => void save(), SAVE_AFTER_MS)
      changed()
    },

    async buyLantern() {
      let paid: string | undefined
      try {
        state.message = null
        if (state.lanterns > 0) throw new Error('You already have a lantern.')

        // A real payment, for a real fraction of a cent. The player signs it;
        // the game delivers in response. Two signatures, never one.
        if ((await kei.balance()) < catalogue.lantern.price && catalogue.network !== 'mainnet') {
          await kei.faucet()
        }
        const receipt = await kei.pay({ to: catalogue.issuer, amount: catalogue.lantern.price })
        paid = receipt.hash

        // The payment is on the chain and cannot say what it was for — a Kei
        // send has no memo field. Its hash names it exactly, so that is what
        // gets sent, and the game matches it against the payment it watched
        // arrive. Money first, order second: nothing here can spend a payment
        // that was never made.
        state.message = 'Paid. Telling the game what it was for…'
        changed()

        const response = await fetch('/game/lantern', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: kei.address, hash: receipt.hash } satisfies LanternOrder),
        })
        const body = (await response.json()) as LanternOutcome | { error?: string }
        if ('error' in body && body.error) throw new Error(body.error)

        state.message =
          'outcome' in body && body.outcome === 'refunded'
            ? `${body.reason} Refunded ${body.amount} Kei.`
            : 'Paid. The lantern is on its way.'
        changed()
      } catch (error) {
        say(error)
        if (paid) {
          // The payment is final and its hash is the only thing that redeems
          // it, so it is not allowed to vanish with the failure. The crystal
          // has room for two lines; the console has room for the hash. It is
          // also in this wallet's own account history, and posting it again is
          // safe — the game delivers once per payment, however often it is
          // asked.
          console.warn(`Paid, not yet delivered. Payment hash: ${paid}`)
          state.message = `${state.message ?? ''} Payment ${paid.slice(0, 8)}… — try again.`
          changed()
        }
      }
    },

    on(listener) {
      listeners.push(listener)
    },

    close() {
      if (timer) clearTimeout(timer)
      kei.close()
    },
  }
}

/** No server, no chain: the game still runs and says why nothing is landing. */
function offline(
  state: EconomyState,
  listeners: Array<(state: EconomyState) => void>,
  changed: () => void,
): Economy {
  return {
    state,
    click() {
      state.unsaved++
      changed()
    },
    async buyLantern() {
      /* nothing to buy without a chain */
    },
    on(listener) {
      listeners.push(listener)
    },
    close() {
      /* nothing running */
    },
  }
}

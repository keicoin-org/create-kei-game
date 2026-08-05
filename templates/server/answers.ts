/**
 * Where an answer is, for the answers that are not in memory.
 *
 * `server/orders.ts` has to be able to say what a payment hash was answered
 * with, for every hash it has ever answered, forever — a re-post of a payment
 * from a year ago must get its lantern back rather than a second one. Holding
 * that in a `Map` means the process grows with the game's lifetime sales and
 * reloads all of it at boot, which is a memory leak with a business reason
 * rather than a bug, and it is still a memory leak.
 *
 * The answers are already on the disk: every one of them is a `done` line in
 * the write-ahead log. What was missing was a way to find one without reading
 * the whole file. This is that way — an open-addressed hash table of fixed-width
 * slots, one file, mapping a payment hash to the byte offset of its `done` line.
 * A lookup is one `pread` of forty bytes and one of the line it names.
 *
 * The three properties that make it safe:
 *
 *   1. **It is a cache of the log, not a second copy of the truth.** Every fact
 *      in it is derivable by reading the log, so a corrupt or missing index
 *      costs a rebuild and nothing else. Nothing is ever *only* here.
 *   2. **It never claims to know more than it does.** The header records how
 *      many bytes of the log the table accounts for. Anything after that has not
 *      been indexed, so `openAnswers` replays it before the table is used. A
 *      miss is only an answer once the table covers the whole log — and that is
 *      what `missIsAuthoritative` says out loud.
 *   3. **A rebuild is safe to interrupt.** It is written to a sibling path and
 *      renamed over the old one, which is a single atomic step. A rebuild killed
 *      halfway leaves the old table in place and a stray file that the next one
 *      overwrites.
 *
 * Memory is one slot at a time. The table is on the disk, where history belongs;
 * what is resident in `orders.ts` is a bounded cache in front of this.
 *
 * The pattern generalises, and it is the one to copy for any cache that has to
 * answer for the whole history of something: put the history where it can be
 * addressed, keep a bounded amount of it resident, and make a miss a read rather
 * than a wrong answer.
 */

import { closeSync, fstatSync, fsyncSync, openSync, readSync, renameSync, writeSync } from 'node:fs'

/** Bumped when the layout below changes, so an old file is rebuilt rather than misread. */
const MAGIC = 'kei-orders-index-1\n'
const MAGIC_BYTES = 24

/**
 * `magic` `capacity` `count` `covers`. Fixed width, written in one call, and
 * only ever written after the slots it describes have reached the disk.
 */
const HEADER_BYTES = MAGIC_BYTES + 4 + 4 + 8

/** A 32-byte hash and the offset of the line it names. */
const KEY_BYTES = 32
const SLOT_BYTES = KEY_BYTES + 8

/** Slots, doubling from here. 1024 slots is 40KB, which is nothing to write at first boot. */
const FIRST_CAPACITY = 1_024

/**
 * Doubling before the table is half full. Linear probing degrades sharply past
 * that, and the cost of being wrong here is a lookup that walks the file.
 */
const MAX_LOAD = 0.5

export interface Answers {
  /** The offset of the `done` line for this hash, or `undefined` if there is none on file. */
  offsetOf(hash: string): number | undefined
  /** Record where a `done` line was written. Idempotent for a hash already recorded. */
  record(hash: string, offset: number): void
  /**
   * Publish the table: everything recorded so far is on the disk and the header
   * says the log is accounted for up to `logLength`. Until this is called a
   * restart replays the log from wherever the last call left off, so calling it
   * more often costs an fsync and calling it less costs a longer boot.
   */
  commit(logLength: number): void
  /** How much of the log the table on the disk accounts for. */
  covers(): number
  close(): void
}

/**
 * Open the index beside `logPath`, replaying whatever it does not cover.
 *
 * `replay` is given the offset to read the log from and hands back every `done`
 * line after it, so the recovery path lives in the file that knows what a `done`
 * line looks like.
 */
export function openAnswers(logPath: string, replay: (from: number) => Iterable<[hash: string, offset: number]>): Answers {
  const path = `${logPath}.index`
  let table = load(path) ?? build(path, FIRST_CAPACITY)

  // Whatever the header does not account for is read off the log now, which is
  // what makes a miss below mean "never answered" rather than "not indexed yet".
  // A crash between a `done` reaching the log and the header saying so is the
  // ordinary case rather than an exceptional one — the header is written on a
  // schedule and the log is written on every answer — so this path runs often
  // and has to be cheap. It is: it reads the log from the last committed offset,
  // not from the start.
  for (const [hash, offset] of replay(table.covers)) {
    insert(table, keyOf(hash), offset)
    if (table.count > table.capacity * MAX_LOAD) table = grow(table, path)
  }

  return {
    offsetOf(hash) {
      return find(table, keyOf(hash))
    },

    record(hash, offset) {
      insert(table, keyOf(hash), offset)
      if (table.count > table.capacity * MAX_LOAD) table = grow(table, path)
    },

    commit(logLength) {
      // The slots first, then the header that vouches for them. The other order
      // is a header promising slots that a crash took, which is a hash that
      // reads as never answered and gets answered twice.
      fsyncSync(table.fd)
      writeHeader(table, logLength)
      fsyncSync(table.fd)
      table.covers = logLength
    },

    covers() {
      return table.covers
    },

    close() {
      closeSync(table.fd)
    },
  }
}

interface Table {
  fd: number
  path: string
  capacity: number
  count: number
  /** Bytes of the log this table accounted for as of the last `commit`. */
  covers: number
}

/**
 * The first four bytes of the hash, as the slot to start probing from. A payment
 * hash is a hash: its bytes are already spread evenly, so there is nothing for a
 * mixing step here to improve.
 */
function slotFor(key: Uint8Array, capacity: number): number {
  return ((key[0]! << 24) | (key[1]! << 16) | (key[2]! << 8) | key[3]!) >>> 0 & (capacity - 1)
}

function keyOf(hash: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error(
      `server/answers.ts indexes payment hashes, and "${hash}" is not one — 64 hex characters is the whole shape. ` +
        'Whatever called this passed something else along; a hash off the chain or out of `kei.pay()` is already this.',
    )
  }
  const key = new Uint8Array(KEY_BYTES)
  const text = hash.toUpperCase()
  for (let index = 0; index < KEY_BYTES; index++) key[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
  return key
}

function isEmpty(slot: Uint8Array): boolean {
  for (let index = 0; index < KEY_BYTES; index++) if (slot[index] !== 0) return false
  return true
}

function sameKey(slot: Uint8Array, key: Uint8Array): boolean {
  for (let index = 0; index < KEY_BYTES; index++) if (slot[index] !== key[index]) return false
  return true
}

function readSlot(table: Table, at: number, into: Uint8Array): void {
  readSync(table.fd, into, 0, SLOT_BYTES, HEADER_BYTES + at * SLOT_BYTES)
}

/**
 * The offset recorded for this key, or `undefined`.
 *
 * Linear probing stops at the first empty slot, which is what makes a miss cheap
 * and is why nothing is ever deleted from this table: a hole in a probe run
 * hides everything behind it. Nothing needs deleting — an answer is permanent.
 */
function find(table: Table, key: Uint8Array): number | undefined {
  const slot = new Uint8Array(SLOT_BYTES)
  for (let step = 0, at = slotFor(key, table.capacity); step < table.capacity; step++) {
    readSlot(table, at, slot)
    if (isEmpty(slot)) return undefined
    if (sameKey(slot, key)) return Number(new DataView(slot.buffer, slot.byteOffset).getBigUint64(KEY_BYTES))
    at = (at + 1) & (table.capacity - 1)
  }
  return undefined
}

function insert(table: Table, key: Uint8Array, offset: number): void {
  const slot = new Uint8Array(SLOT_BYTES)
  for (let step = 0, at = slotFor(key, table.capacity); step < table.capacity; step++) {
    readSlot(table, at, slot)
    const free = isEmpty(slot)
    if (free || sameKey(slot, key)) {
      const record = new Uint8Array(SLOT_BYTES)
      record.set(key)
      new DataView(record.buffer).setBigUint64(KEY_BYTES, BigInt(offset))
      writeSync(table.fd, record, 0, SLOT_BYTES, HEADER_BYTES + at * SLOT_BYTES)
      if (free) table.count++
      return
    }
    at = (at + 1) & (table.capacity - 1)
  }
  // Unreachable while `MAX_LOAD` is below 1: `grow` runs before the table fills.
  throw new Error(`server/answers.ts: the index at ${table.path} is full at ${table.capacity} slots.`)
}

function writeHeader(table: Table, covers: number): void {
  const header = new Uint8Array(HEADER_BYTES)
  header.set(new TextEncoder().encode(MAGIC))
  const view = new DataView(header.buffer)
  view.setUint32(MAGIC_BYTES, table.capacity)
  view.setUint32(MAGIC_BYTES + 4, table.count)
  view.setBigUint64(MAGIC_BYTES + 8, BigInt(covers))
  writeSync(table.fd, header, 0, HEADER_BYTES, 0)
}

/** An existing table, or `undefined` for one that is absent, truncated, or of another layout. */
function load(path: string): Table | undefined {
  let fd: number
  try {
    fd = openSync(path, 'r+')
  } catch {
    return undefined
  }

  const header = new Uint8Array(HEADER_BYTES)
  const read = readSync(fd, header, 0, HEADER_BYTES, 0)
  const view = new DataView(header.buffer)
  const capacity = read === HEADER_BYTES ? view.getUint32(MAGIC_BYTES) : 0
  const magic = new TextDecoder().decode(header.subarray(0, MAGIC.length))

  const whole = capacity > 0 && (capacity & (capacity - 1)) === 0
  const complete = whole && fstatSync(fd).size >= HEADER_BYTES + capacity * SLOT_BYTES
  if (magic !== MAGIC || !complete) {
    closeSync(fd)
    return undefined
  }

  return {
    fd,
    path,
    capacity,
    count: view.getUint32(MAGIC_BYTES + 4),
    covers: Number(view.getBigUint64(MAGIC_BYTES + 8)),
  }
}

/** A table of `capacity` empty slots at `path`, replacing whatever was there. */
function build(path: string, capacity: number): Table {
  const fd = openSync(path, 'w+')
  const table: Table = { fd, path, capacity, count: 0, covers: 0 }
  // One write for the whole file, so a slot is never read out of a hole the
  // filesystem has not decided about yet.
  writeSync(fd, new Uint8Array(HEADER_BYTES + capacity * SLOT_BYTES), 0, HEADER_BYTES + capacity * SLOT_BYTES, 0)
  writeHeader(table, 0)
  fsyncSync(fd)
  return table
}

/**
 * Twice the slots, filled from the table it replaces, published by one rename.
 *
 * The rename is the whole safety story. Until it happens the old table is the
 * one on the path and is complete; after it, the new one is, and it accounts for
 * exactly what the old one did. A process killed anywhere in between leaves a
 * `.rebuilding` file that the next rebuild overwrites — `openAnswers` never
 * opens that path, so a half-written one is never read.
 */
function grow(table: Table, path: string): Table {
  const rebuilding = `${path}.rebuilding`
  const next = build(rebuilding, table.capacity * 2)

  const slot = new Uint8Array(SLOT_BYTES)
  for (let at = 0; at < table.capacity; at++) {
    readSlot(table, at, slot)
    if (isEmpty(slot)) continue
    insert(next, slot.subarray(0, KEY_BYTES), Number(new DataView(slot.buffer, slot.byteOffset).getBigUint64(KEY_BYTES)))
  }
  writeHeader(next, table.covers)
  next.covers = table.covers
  fsyncSync(next.fd)

  closeSync(table.fd)
  closeSync(next.fd)
  renameSync(rebuilding, path)

  const grown = load(path)
  if (!grown) throw new Error(`server/answers.ts rebuilt the index at ${path} and could not read back what it wrote.`)
  return grown
}

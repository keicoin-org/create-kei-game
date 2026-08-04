/** Legitimate tiny runtime-media fixtures: structurally valid PNG, GLB, and Ogg Opus bytes. */

import { deflateSync } from 'node:zlib'

export const CC0_TEXT = `Creative Commons Legal Code

CC0 1.0 Universal

Statement of Purpose: the person who associated a work with this deed has
dedicated the work to the public domain by waiving all of his or her rights
to the work worldwide under copyright law, including all related and
neighboring rights, to the extent allowed by law. No Copyright.
`

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(pngCrc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0)
  return Buffer.concat([header, data, crc])
}

/** An 8x8 greyscale PNG with a real deflate stream and valid chunk CRCs. */
export function tinyPng(): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8
  const rows: Buffer[] = []
  for (let y = 0; y < 8; y += 1) {
    const row = Buffer.alloc(9)
    for (let x = 0; x < 8; x += 1) row[1 + x] = (x * 32 + y * 7) & 0xff
    rows.push(row)
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

/** A minimal glTF 2.0 binary: one triangle mesh, plus one translation animation when requested. */
export function tinyGlb(kind: 'model' | 'animation'): Buffer {
  const bin = Buffer.alloc(68)
  bin.writeFloatLE(1, 12)
  bin.writeFloatLE(1, 28)
  bin.writeFloatLE(1, 40)
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
  if (kind === 'animation') gltf.animations = [{ channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }] }]
  let json = Buffer.from(JSON.stringify(gltf), 'utf8')
  if (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)])
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(json.length, 0)
  jsonHeader.write('JSON', 4, 'ascii')
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, json, binHeader, bin])
}

function oggCrc32(bytes: Uint8Array): number {
  let crc = 0
  for (const byte of bytes) {
    crc = ((crc << 8) >>> 0) ^ oggTable[((crc >>> 24) ^ byte) & 0xff]!
  }
  return crc >>> 0
}

const oggTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let r = (n << 24) >>> 0
    for (let k = 0; k < 8; k += 1) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    table[n] = r
  }
  return table
})()

function oggPage(serial: number, sequence: number, granule: bigint, flags: number, packets: readonly Buffer[]): Buffer {
  const segments = packets.map((packet) => {
    if (packet.length >= 255) throw new Error('fixture packets must stay below one lacing segment')
    return packet.length
  })
  const header = Buffer.alloc(27 + segments.length)
  header.write('OggS', 0, 'ascii')
  header[5] = flags
  header.writeBigUInt64LE(granule, 6)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header[26] = segments.length
  segments.forEach((value, index) => { header[27 + index] = value })
  const page = Buffer.concat([header, ...packets])
  page.writeUInt32LE(oggCrc32(page), 22)
  return page
}

/** A minimal Ogg Opus stream: identification, tags, and one terminating audio page with valid page CRCs. */
export function tinyOgg(): Buffer {
  const serial = 0x6b6569
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head[8] = 1
  head[9] = 1
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  const vendor = Buffer.from('kei', 'utf8')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'ascii')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  const audio = Buffer.from([0xfc, 0xff, 0xfe])
  return Buffer.concat([
    oggPage(serial, 0, 0n, 0x02, [head]),
    oggPage(serial, 1, 0n, 0x00, [tags]),
    oggPage(serial, 2, 960n, 0x04, [audio]),
  ])
}

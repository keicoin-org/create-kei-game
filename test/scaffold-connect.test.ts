import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { projectFiles } from '../src/scaffold.js'
import { planFor } from './fixtures.js'

const root = mkdtempSync(join(tmpdir(), 'kei-connect-unit-'))

let helloCode: (raw: string) => string | null
let authoritativeSnapshot: (playerId: string) => {
  readonly tick: number
  readonly players: Readonly<Record<string, unknown>>
}

beforeAll(async () => {
  const plan = planFor({
    name: 'Connect Unit',
    dimension: '2d',
    gameplay: 'One player enters an authoritative construction room.',
  })
  for (const file of projectFiles({ slug: 'connect-unit', title: 'Connect Unit' }, plan)) {
    if (!['src/shared/simulation.ts', 'src/shared/protocol.ts', 'src/server/main.ts'].includes(file.path)) continue
    const target = join(root, ...file.path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents, 'utf8')
  }
  const protocol = await import(pathToFileURL(join(root, 'src/shared/protocol.ts')).href)
  const server = await import(pathToFileURL(join(root, 'src/server/main.ts')).href)
  helloCode = protocol.helloCode as typeof helloCode
  authoritativeSnapshot = server.authoritativeSnapshot as typeof authoritativeSnapshot
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('generated game connection protocol', () => {
  test('accepts only the exact v1 hello', () => {
    expect(helloCode('{"v":1,"type":"hello"}')).toBeNull()
    expect(helloCode('{"v":2,"type":"hello"}')).toBe('protocol_mismatch')
    expect(helloCode('{"v":1,"type":"hello","extra":true}')).toBe('invalid_message')
    expect(helloCode('not json')).toBe('invalid_message')
  })

  test('the server authors an initial snapshot for its assigned identity', () => {
    expect(authoritativeSnapshot('server-assigned')).toEqual({
      tick: 0,
      players: { 'server-assigned': { x: 0, y: 0, z: 0 } },
    })
  })
})

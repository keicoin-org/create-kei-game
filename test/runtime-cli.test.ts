import { beforeAll, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { ensureBuilt } from './built.js'
import { requireProcessSuccess, runProcess } from './process.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = fileURLToPath(new URL('../dist/runtime-main.js', import.meta.url))

beforeAll(ensureBuilt)

test('built engine executable speaks protocol-only JSONL', async () => {
  const request = {
    workspace: process.platform === 'win32' ? 'C:\\workspace\\game' : '/workspace/game',
    provider: {
      provider: 'openai',
      protocol: 'responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
    model: 'model-id',
    brief: 'Build a game.',
  }
  const input = [
    { v: 1, type: 'open', id: 'game', request },
    { v: 1, type: 'close', id: 'game' },
    { v: 1, type: 'shutdown' },
  ].map((value) => JSON.stringify(value)).join('\n') + '\n'
  const node = Bun.which('node')
  expect(node).not.toBeNull()
  if (node === null) throw new Error('Node.js executable is unavailable')
  const result = await runProcess(node, [entry], { cwd: root, input, timeoutMs: 30_000 })
  requireProcessSuccess('runtime-cli', result)
  expect(result.stderr).toBe('')
  expect(result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line))).toEqual([
    { v: 1, type: 'accepted', id: 'game', command: 'open' },
    { v: 1, type: 'accepted', id: 'game', command: 'close' },
    { v: 1, type: 'shutdown' },
  ])
})

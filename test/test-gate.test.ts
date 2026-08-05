import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('the full gate isolates the spawn-heavy agent CLI suite without dropping it', () => {
  const script = fileURLToPath(new URL('../scripts/test-gate.ts', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--plan'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  })
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  const suites = JSON.parse(result.stdout) as Array<{ name: string; files: string[]; timeoutMs: number; testTimeoutMs?: number }>
  expect(suites.map(({ name }) => name)).toEqual(['unit', 'scaffold-polish', 'agent-cli'])
  expect(suites[0]!.files).not.toContain('./test/agent-cli.test.ts')
  expect(suites[0]!.files).not.toContain('./test/scaffold-polish.test.ts')
  expect(suites[1]!.files).toEqual(['./test/scaffold-polish.test.ts'])
  expect(suites[2]!.files).toEqual(['./test/agent-cli.test.ts'])
  expect(suites.every(({ timeoutMs }) => Number.isSafeInteger(timeoutMs) && timeoutMs > 0)).toBeTrue()
  expect(suites.find(({ name }) => name === 'scaffold-polish')?.testTimeoutMs).toBe(15_000)
  const covered = suites.flatMap(({ files }) => files)
  expect(new Set(covered).size).toBe(covered.length)
})

test('the gate propagates a child assertion-style nonzero exit', () => {
  const script = fileURLToPath(new URL('../scripts/test-gate.ts', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--probe-failure'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('gate-failure-probe')
  expect(result.stderr).toContain('"status":7')
})

test('the gate propagates a timeout only after its spawned descendant is gone', () => {
  const script = fileURLToPath(new URL('../scripts/test-gate.ts', import.meta.url))
  const result = spawnSync(process.execPath, [script, '--probe-timeout'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('gate-timeout-probe')
  expect(result.stderr).toContain('ETIMEDOUT')
  const pid = Number(/leaf-pid:(\d+)/.exec(result.stdout)?.[1])
  expect(Number.isSafeInteger(pid) && pid > 0).toBeTrue()
  let alive = true
  try { process.kill(pid, 0) } catch { alive = false }
  expect(alive).toBeFalse()
}, 30_000)

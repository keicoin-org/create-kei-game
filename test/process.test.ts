import { describe, expect, test } from 'bun:test'

import { processFailureDiagnostic, requireProcessSuccess } from './process.js'

describe('bounded process diagnostics', () => {
  test('an injected spawn error reports its safe OS fields instead of an undefined status assertion', () => {
    const error = Object.assign(
      new Error(`spawn failed\n${'x'.repeat(400)}`),
      { code: 'EAGAIN' },
    )
    const result = {
      status: null,
      signal: null,
      stdout: 'request body that must not be reported',
      stderr: 'generated secret that must not be reported',
      error,
    } as const

    const diagnostic = processFailureDiagnostic('runtime-cli', result)
    expect(diagnostic.length).toBeLessThan(400)
    expect(JSON.parse(diagnostic)).toMatchObject({
      event: 'test_process_failed',
      phase: 'runtime-cli',
      status: null,
      signal: null,
      errorCode: 'EAGAIN',
    })
    expect(diagnostic).toContain('spawn failed')
    expect(diagnostic).not.toContain('\n')
    expect(diagnostic).not.toContain('request body')
    expect(diagnostic).not.toContain('generated secret')
    expect(() => requireProcessSuccess('runtime-cli', result)).toThrow(diagnostic)
  })
})

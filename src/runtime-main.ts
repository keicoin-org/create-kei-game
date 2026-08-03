#!/usr/bin/env node
import { stdin, stdout } from 'node:process'

import { runJsonlEngine } from './runtime-protocol.js'
import type { ModelTransport } from './runtime.js'

const unavailable: ModelTransport = {
  async generate() {
    throw new Error('No provider transport is installed.')
  },
}

await runJsonlEngine(
  stdin as unknown as AsyncIterable<Uint8Array | string>,
  async (line) => {
    await new Promise<void>((resolve, reject) => {
      stdout.write(line, (error) => error ? reject(error) : resolve())
    })
  },
  { create: () => ({ transport: unavailable }) },
)

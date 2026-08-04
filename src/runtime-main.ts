#!/usr/bin/env node
/**
 * `create-kei-mmo-engine`: the shared creation engine as a long-running JSONL
 * process. Stdout carries the protocol and nothing else, which is why nothing
 * in here logs.
 */
import { env, stdin, stdout } from 'node:process'

import { nodeToolFs, nodeToolPath } from './adapters.js'
import { creationRuntimeFactory } from './creation-runtime.js'
import type { HttpFetch } from './provider-transport.js'
import { runJsonlEngine } from './runtime-protocol.js'

const nodeFetch: HttpFetch = (url, request) => fetch(url, request)

await runJsonlEngine(
  stdin as unknown as AsyncIterable<Uint8Array | string>,
  async (line) => {
    await new Promise<void>((resolve, reject) => {
      stdout.write(line, (error) => error ? reject(error) : resolve())
    })
  },
  creationRuntimeFactory({ fetch: nodeFetch, environment: env, fs: nodeToolFs, path: nodeToolPath }),
)

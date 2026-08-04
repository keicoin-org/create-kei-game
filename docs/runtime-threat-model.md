# Runtime threat model

The engine accepts model output, tool arguments and results, project paths, and
JSONL input as untrusted data. This narrows what those values can do; it does not
claim that arbitrary future tools are safe.

## Trust boundaries

The front end may choose a provider, model, intent, workspace, and prompt. It
never sends a credential value. The engine receives a validated `apiKeyEnv`
reference and resolves it against **its own inherited environment**, immediately
before each request. The resolved value goes into exactly one request header —
`x-api-key` for `messages`, `authorization: Bearer` otherwise — and is never
stored on an object, added to a message, event, error, or tool input, or written
to a project file.

A model that tries to write the credential into the project is refused by
`write_file`, which compares content against the freshly-read value and declines
the write. `.env` is refused outright, since it is the file a credential would
otherwise land in.

Model output and tool results are data, not protocol. Only the engine creates
JSONL envelopes. JSON serialization prevents content from injecting a second
record. Tool arguments and results are never copied into public progress events.

## Enforced controls

- Lines are bounded before UTF-8 decoding and JSON parsing. Invalid UTF-8 and
  parser diagnostics are replaced with stable messages.
- Provider identifiers, protocols, HTTPS base URLs, environment names, model
  length, brief length, and absolute workspace paths are validated at `open`.
- The transport and tool interfaces receive an `AbortSignal`. The engine races
  calls against cancellation and timeout even when an adapter ignores the
  signal.
- Prompt bytes, retained transcript bytes, turn count, assistant bytes, tool-call count and identifier
  bytes, serialized argument bytes, per-result bytes, cumulative result bytes,
  wall time, and open sessions are bounded.
- A session rejects overlapping direct or protocol turns. Failure rolls back
  partial transcript state.
- Transport and tool exceptions are reduced to stable codes and generic text.
  A transport may choose its code from a fixed provider set; it never supplies
  the words. The thrown error object is discarded rather than rethrown, so a
  response body, an OS or parser diagnostic, a stack trace, config contents, a
  credential reference, or a credential value cannot travel out inside one.
- Provider responses are size-capped before parsing, and a body that is not JSON
  or not the expected shape is `provider_response_invalid` rather than a partial
  read. Tool arguments that are not valid JSON are refused rather than repaired,
  so no tool runs on a guess.
- Workspace tools resolve every path through `realpath` and verify containment
  against the resolved workspace, which covers a symlink that was already in the
  tree. Reads, writes, listing breadth, listing depth, and path depth are all
  bounded, and the tools never spawn a process or open a socket.
- Shutdown cancels and settles active turns before its terminal record.

## Responsibilities of future adapters and tools

The shipped provider transport meets these rules and any additional adapter must
too: resolve credentials only immediately before the request, use the configured
HTTPS endpoint without widening URL rules, honor cancellation, cap its own
response body, and map upstream failures to a stable code with no upstream text.
It must never log request headers or response bodies to the JSONL stream.

Tools need a declared JSON schema and a narrow workspace-scoped capability.
Filesystem tools must resolve and verify paths remain inside the session
workspace, avoid shell interpolation, and make destructive operations explicit.
Network and process tools require separate policy decisions. Tool descriptions
are not authorization.

Assistant text is intentionally visible to the driving front end and may
contain project content. A front end must treat it as untrusted display text,
not terminal escape sequences or commands. The future Rust TUI must sanitize
terminal control characters before rendering.

## Not implemented

There is no process tool, network tool, package installer, terminal UI, session
persistence, or unattended re-invocation. `write_file` is the only mutation, and
it is bounded and workspace-scoped. These absences are security boundaries, not
completed features.

Three limits worth stating rather than leaving to be discovered. A model can
overwrite any file in the workspace it was pointed at, including one the
developer wrote — the harness does not snapshot or back it up, and version
control is the developer's. That matters most when the planner decided to clone
a reference project: the workspace is then somebody else's working code, and the
turn may rewrite it. And the credential check on writes compares against the
value the harness holds; it is a guard against the obvious accident, not a
general data-loss-prevention control.

The third runs the other way, and the write-side rules do not imply it. **The
harness protects the project from the harness's credential; it does not protect
the project's own secrets from the provider.** `read_file` reads any UTF-8 file
in the workspace, `.env` included — the basename refusal is on writes only — and
whatever it reads enters the transcript, which is sent upstream on the next turn.
For a scaffolded workspace there is nothing there to leak. For a workspace the
harness cloned, or a directory a caller pointed the engine at over JSONL, there
may well be. Whether reads should carry their own refusal list is an open
decision, not a settled one.

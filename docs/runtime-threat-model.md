# Runtime threat model

The engine accepts model output, tool arguments and results, project paths, and
JSONL input as untrusted data. This checkpoint narrows what those values can do;
it does not claim that arbitrary future tools are safe.

## Trust boundaries

The front end may choose a provider, model, brief, workspace, and prompt. It
never sends a credential value. The engine receives a validated `apiKeyEnv`
reference, while a future provider adapter will resolve the value privately.
Model transports receive the reference so adapters can select their credential,
but transports must not add resolved values to messages, events, thrown errors,
or tool inputs.

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
  Stack traces, OS/parser diagnostics, config contents, credential references,
  and thrown values are not serialized as errors.
- Shutdown cancels and settles active turns before its terminal record.

## Responsibilities of future adapters and tools

A provider adapter must resolve credentials only immediately before its private
network request, use the configured HTTPS endpoint without widening URL rules,
honor cancellation, cap its own response body, and map upstream failures to a
generic transport exception. It must never log request headers or response
bodies to the JSONL stream.

Tools need a declared JSON schema and a narrow workspace-scoped capability.
Filesystem tools must resolve and verify paths remain inside the session
workspace, avoid shell interpolation, and make destructive operations explicit.
Network and process tools require separate policy decisions. Tool descriptions
are not authorization.

Assistant text is intentionally visible to the driving front end and may
contain project content. A front end must treat it as untrusted display text,
not terminal escape sequences or commands. The future Rust TUI must sanitize
terminal control characters before rendering.

## Not implemented in this checkpoint

There is no real provider transport, filesystem mutation tool, process tool,
network tool, terminal UI, persistence, or automatic project launch. The engine
binary returns a redacted `transport_error` for a turn until a reviewed provider
adapter is installed. These absences are security boundaries, not completed
features.

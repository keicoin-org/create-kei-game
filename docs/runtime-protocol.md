# Engine JSONL protocol

The TypeScript creation engine has one versioned JSON-lines boundary for both
automation and the future Kei TUI. Front ends write one UTF-8 JSON object per
line and read one JSON object per line. The engine process stays alive across
sessions and turns; it does not own terminal rendering or input.

This checkpoint defines the engine, boundary, and provider/tool interfaces. It
does not make provider network calls. `create-kei-game-engine` therefore runs
the real protocol with an unavailable transport: `open` works and `turn`
returns `transport_error`. Provider adapters will be a later slice.

## Start the process

From this unpublished checkout:

```sh
bun run src/runtime-main.ts
```

After a future package release:

```sh
create-kei-game-engine
```

Stdout is protocol-only. A caller must not mix logs with the JSONL stream.

## Input commands

Every command has `v: 1`. Session IDs are caller-chosen ASCII identifiers of at
most 128 characters: a letter or digit followed by letters, digits, `.`, `_`,
or `-`. Unknown command/request/provider fields are rejected rather than
silently ignored.

Open a session with an absolute workspace and sanitized provider settings:

```json
{"v":1,"type":"open","id":"game-1","request":{"workspace":"/work/tiny-quest","provider":{"provider":"openai","protocol":"responses","baseUrl":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY"},"model":"provider-model-id","brief":"Build a cooperative puzzle game."}}
```

The credential value is not part of this object. `apiKeyEnv` is only a
reference. The process that eventually constructs a real provider adapter will
resolve that reference internally.

Run any number of sequential turns in the same session:

```json
{"v":1,"type":"turn","id":"game-1","prompt":"Add a locked door and its key."}
{"v":1,"type":"turn","id":"game-1","prompt":"Now add a two-player switch."}
```

Cancel the active turn, close an idle session, or terminate the process:

```json
{"v":1,"type":"cancel","id":"game-1"}
{"v":1,"type":"close","id":"game-1"}
{"v":1,"type":"shutdown"}
```

Only one turn may run per session. Different sessions may run concurrently.
`shutdown` cancels active work, waits for it to settle, suppresses the expected
cancellation errors, and is always the final output object.

## Output

Commands first receive an acknowledgement:

```json
{"v":1,"type":"accepted","id":"game-1","command":"turn"}
```

Engine events carry a monotonically increasing per-session sequence number:

```json
{"v":1,"type":"event","id":"game-1","seq":1,"event":{"type":"turn_started","turn":1}}
{"v":1,"type":"event","id":"game-1","seq":2,"event":{"type":"assistant","turn":1,"content":"I will add the door and key."}}
{"v":1,"type":"event","id":"game-1","seq":3,"event":{"type":"completed","turns":1,"outputBytes":32}}
```

Tool events expose the call ID, tool name, and result byte count. They do not
echo tool arguments or results. The model transcript remains inside the shared
engine so a later turn has the same context regardless of which front end sent
it.

Errors are stable, redacted objects:

```json
{"v":1,"type":"error","id":"game-1","error":{"code":"turn_limit","message":"Engine turn count exceeded its limit."}}
```

Protocol codes are `invalid_json`, `invalid_message`, `unsupported_version`,
`line_too_large`, `session_exists`, `session_not_found`, `session_busy`,
`session_limit`, and `internal_error`. Engine codes are `cancelled`, `timeout`,
`prompt_limit`, `history_limit`, `turn_limit`, `output_limit`, `tool_call_limit`, `tool_argument_limit`,
`tool_result_limit`, `transport_error`, `tool_not_found`, `tool_error`, and
`invalid_runtime`. Callers branch on codes, not messages.

## Bounds and recovery

- Input lines: 65,536 bytes, enforced before decoding or parsing.
- Open sessions: 16 per process.
- Prompt per turn: 65,536 UTF-8 bytes.
- Retained session transcript: 4,194,304 UTF-8 bytes.
- Model rounds per turn: 24.
- Assistant output per turn: 524,288 UTF-8 bytes.
- Tool calls per model round: 32.
- Tool call IDs: 256 UTF-8 bytes; tool names: 128 UTF-8 bytes.
- Arguments per tool call: 65,536 serialized UTF-8 bytes.
- Result per tool call: 65,536 UTF-8 bytes.
- Cumulative tool results per turn: 524,288 UTF-8 bytes.
- Wall time per turn: 30 minutes.

Library embedders may lower engine limits. A failed, cancelled, or timed-out
turn rolls its partial user, assistant, tool-call, and tool-result messages out
of session history. A later turn therefore never continues from half-applied
state.

The public library entry points are `create-kei-game/runtime` and
`create-kei-game/runtime-protocol`. Deterministic scripted transports and tools
are included for adapter and front-end contract tests; production code must not
mistake them for provider adapters.

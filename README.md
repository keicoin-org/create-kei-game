# create-kei-game

Scaffolds a browser game with a real currency, real items, and a wallet the
player owns.

```sh
npm create kei-game
```

It asks what the project is called and what the currency is called, writes a
working game, and exits.

```sh
npm create kei-game star-clicker -- --currency "Gold Pieces"
bun create kei-game star-clicker --currency "Gold Pieces"
```

| Option | |
|---|---|
| `--template <name>` | Which game to start from. Default: `star-clicker` |
| `--currency <name>` | What the in-game currency is called. Default: `Coins` |
| `--yes`, `-y` | Take the defaults and ask nothing. For CI and agents. |
| `--json` | Print structured failure diagnostics for automation. |
| `--force` | Write into a directory that already has files in it. |
| `--help`, `-h` | The above. |

## The three templates

| | |
|---|---|
| **`star-clicker`** | A 3D scene, a currency, and an item you buy for a fraction of a cent. Ten files, single-player. The default, and the one to read first. |
| **`world-of-wonder`** | A multiplayer 3D RPG whose gold and items are on the chain — Babylon.js and Colyseus, with movement, combat, quests, a navmesh, a vendor, and a bag. Forked from [orion3dgames/t5c](https://github.com/orion3dgames/t5c). |
| **`carpet-markets`** | A coin launchpad with no bonding curve and no house: a launcher is minted the whole supply, every trade is a player-written offer settled by consensus, and whether a market in a coin can exist at all is the coin's own transfer policy, chosen at launch and immutable after. |

```sh
npm create kei-game my-mmo -- --template world-of-wonder --currency "Shards"
```

`star-clicker` is written from inside this package. The other two are whole
example projects that live in their own repositories and are downloaded when you
ask for one — a 30MB tarball of `.glb` models has no business inside a scaffolder
most people run to get a star and a button. That is the only difference; what
lands on disk is yours either way.

Downloading means `--template world-of-wonder` and `--template carpet-markets`
need a network. `star-clicker`, the default, does not.

### What `star-clicker` writes

```
star-clicker/
├── .gitignore
├── README.md
├── src/economy.ts     every line of Kei in the browser
├── src/world.ts       the Babylon.js scene — knows nothing about Kei
├── src/main.ts        joins the two
├── server/game.ts     the whole backend: issues the currency, sells the item
├── server/orders.ts   payment-hash write-ahead log and restart recovery
├── server/main.ts     bun run dev — node, issuer, and client in one process
├── shared/game.ts     the price list
├── index.html
├── package.json
└── tsconfig.json      strict type-check for the emitted project
```

```sh
cd star-clicker
bun install
bun run dev
```

## Two prompts, and no more

Every question a scaffolder asks is a decision the developer has to make before
they have any information with which to make it. So this one asks about the
project and the currency, and decides the rest:

- **The renderer is Babylon.js**, and `src/world.ts` documents how to replace
  it. The SDK is framework-agnostic; the game does its own rendering.
- **The ticker is derived** from the currency name — `Gold Pieces` becomes
  `GOLD` — and printed before anything is written.
- **`star-clicker` is single-player**, because a game that is only fun when
  someone else is online is the wrong thing to start from. Reach for
  `world-of-wonder` when multiplayer is the point rather than a step.

The template is a flag rather than a fourth prompt for the same reason. Someone
who does not know they want an MMO wants the default, and someone who does knows
it before they type the command.

`carpet-markets` is asked one question, not two: it has no currency of its own,
because every coin on it is launched by a player at runtime.

## Failures, for a program reading them

`--json` makes a failed run print one JSON object and exit 1. Nothing else about
the run changes, and a run that succeeds prints what it always did.

```console
$ create-kei-game --json my-game --currency '!!!' --yes
{
  "status": "error",
  "code": "currency_unusable",
  "stage": "answers",
  "step": "derive-symbol",
  "retryable": false,
  "remediation": "Start the currency name with a letter or a digit, like \"Gems\".",
  "message": "A currency called \"!!!\" gives the ticker \"\", which the chain will not accept. …"
}
```

| Field | |
|---|---|
| `status` | `"error"`. Present so a reader can branch before looking at anything else. |
| `code` | What failed, as a name. Stable: adding a code is not a breaking change, renaming one is. |
| `stage` | `arguments`, `answers`, `template`, `target` or `internal`. |
| `step` | The operation inside the stage, for a report that wants to be specific. |
| `retryable` | Whether the same command, unchanged, could succeed later. |
| `remediation` | One imperative sentence: what to change before running it again. |
| `message` | The sentence a person reads. Free prose — assert on `code`, not on this. |

`retryable` is the field worth wiring up. Exactly one thing here fails for
reasons outside the command — downloading a template that lives in its own
repository — so `template_unreachable`, `template_corrupt`, and a
`template_http_error` carrying a 5xx are true, and everything else is false. A
false is a run not worth spending: the input has to change first.

The codes, by stage:

| Stage | Codes |
|---|---|
| `arguments` | `flag_missing_value`, `flag_unknown`, `name_repeated` |
| `answers` | `name_empty`, `name_unusable`, `name_too_long`, `currency_empty`, `currency_unusable`, `answer_unprintable`, `answer_too_long`, `input_not_interactive` |
| `template` | `template_unknown`, `template_unreachable`, `template_http_error`, `template_corrupt`, `template_drifted` |
| `target` | `target_not_empty` |
| `internal` | `internal_error` |

`internal_error` is a bug in this package rather than in the command, and it is
the one case where stdout is not the whole story: the envelope goes to stdout as
always and whatever the runtime raised goes to stderr, stack included when there
is one.

`input_not_interactive` is the one an unattended caller meets first. It means the
two questions had nowhere to be asked — pass `--yes`, or give the answers as
flags.

Without `--json`, a failure is a sentence and nothing else, which is SPEC §6.1
and is unchanged.

## It is not a framework

The generated project does not import this package, does not depend on it, and
does not know it exists. Delete `create-kei-game` from your machine and the game
still builds and still runs — that is the test, and it has one.

It has a harder one too: `bun test` writes the project out, imports both halves,
and buys the item, so an SDK change that breaks the emitted code fails here
rather than in somebody's brand-new project.

`bun run typecheck` compiles the template as well as this package —
`tsconfig.templates.json` extends the config the generated project ships with,
against the same dependency versions it declares. `templates/` is the product,
so a type error in it is a type error in what you shipped.

The downloaded templates get a strict version of the same treatment. Renaming one
has to find the project's name, its currency, and its README exactly where it
expects them, and **fails loudly when it does not** — so a drift in either of
those repositories breaks a test here, rather than quietly scaffolding a project
that still calls itself `world-of-wonder` and still pays in Gold.

This package installs nothing of its own, either — not even to unpack a tarball.
It is a program that writes files, and the first thing you wait for is your
game's dependencies.

---

Part of [`kei-transaction`](https://keicoin.org). SPEC §11.3.

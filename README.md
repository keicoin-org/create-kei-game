# create-kei-game

The harness for building Kei games. This repository is where it is developed and
released from; it is no longer a package inside another repository.

**Today it prepares the project and stops.** It asks what the project is called
and where it starts from, puts that on disk, and exits. That is the whole of the
current behaviour, and everything below describes it.

**What it does not do yet:** choose an AI provider, hold any credentials, or run
the Kei terminal interface that will build the game with you. Those are later
work in M9. Nothing in this README describes unreleased work except this
paragraph.

```sh
npm create kei-game
```

```sh
npm create kei-game my-game -- --template button
npm create kei-game my-game -- --source repository --from https://github.com/you/your-game.git
bun create kei-game my-game --source local --from ../a-project-i-already-have
```

## Where a project starts from

Four answers, and only four.

| | |
|---|---|
| **`blank`** | An empty workspace: `package.json`, `README.md`, `.gitignore`, `src/main.ts`. No renderer, no server, no dependencies, and nothing to delete first. The default. |
| **`template`** | One of the three games below, cloned from its own repository. |
| **`local`** | A project already on this disk. Used where it lies, and never written to. |
| **`repository`** | A GitHub or GitLab repository, cloned over `https`. |

`template` and `repository` need `git` and a network. `blank` and `local` need
neither.

## The three templates

| | |
|---|---|
| **`button`** | One button, one currency, one item. The small one, and the one to read first. |
| **`world-of-wonder`** | A multiplayer 3D RPG whose gold and items are on the chain — Babylon.js and Colyseus, with movement, combat, quests, a navmesh, a vendor, and a bag. |
| **`carpet-markets`** | A coin launchpad where whether a coin can be rugged is not a promise but the deed's transfer policy, chosen at launch and enforced by consensus. |

Each lives in its own repository and is cloned when you ask for one. None of them
is packaged inside this command: a 30MB tarball of `.glb` models has no business
inside something most people run to get an empty directory with the lights on.

## Options

| Option | |
|---|---|
| `--source <kind>` | `blank`, `template`, `local`, or `repository`. Default: `blank` |
| `--template <name>` | `button`, `world-of-wonder`, or `carpet-markets`. Implies `--source template`. |
| `--from <path\|url>` | The path for `local`, the `https` URL for `repository`. |
| `--into <directory>` | Where it lands. Default: the project name, in the current directory. |
| `--force` | Write a blank workspace into a directory that has files in it. Overwrites files of the same name, deletes nothing, and does not apply to a clone. |
| `--yes`, `-y` | Take the defaults and ask nothing. For CI and agents. |
| `--help`, `-h` | The above. |
| `--version`, `-v` | Print the version and exit. |

Combinations that contradict each other are refused with a sentence rather than
resolved by guessing: `--template` belongs to `--source template` and nowhere
else, `--from` belongs to `local` and `repository` and nowhere else, and a source
that needs a detail will not run without it — including under `--yes`.

## Two prompts, and no more

Every question a harness asks is a decision you have to make before you have any
information with which to make it. So it asks two, in this order:

1. **Project name.** It becomes the directory: `My Game` → `my-game/`.
2. **Where it starts from.** One of the four above — and then, only if that
   answer needs one, the single detail it implies: which template, which path,
   which URL.

There is no currency question. A blank workspace has none, and the games that do
have one declare it in their own source, which is where it belongs.

Anything typable at a prompt is a flag, so nothing here needs a terminal. With
nothing attached to the input — CI, a pipe, an agent — an incomplete command
fails immediately and says which flags would have answered it. It never hangs and
never guesses.

## Cloning is `spawn`, never a shell

A repository URL out of a prompt is handed to `spawn('git', [...], { shell:
false })` as an argument in an array. There is no command string anywhere in the
package for it to be interpolated into, so there is nothing for a `;` in a URL to
do. Before that, the URL has to parse as `https://github.com/owner/name` or the
GitLab equivalent, carry no credentials, no port, no query, and no fragment.

A clone into a directory that is not empty is refused, and `--force` does not
change that: `git` needs an empty directory and nothing here will empty one for
it. `--force` means one thing only — write the blank workspace in alongside what
is already there, overwriting files of the same name and deleting nothing.

## It is not a framework

The prepared files do not import this package, do not depend on it, and do not
know it exists. Delete `create-kei-game` from your machine and the project is
unchanged: it remains yours to inspect, edit, build, and run as it is.

This package installs nothing of its own, either. It is a program that writes
four files or runs one `git clone`, and the first thing you wait for is your
game's dependencies.

## Working on this repository

Bun 1.3.0, or Node >= 20 for the published binary.

```sh
bun install
bun run typecheck   # tsc --build, then the tests' own type-check
bun test
bun run build       # emits dist/
bun run check       # typecheck + test
```

`bun run clean` removes the build output.

The whole of the source logic — which sources exist, what each one means, what
is refused — is in `src/source.ts`, which imports nothing from Node. The
filesystem, the path rules, and `git` arrive as arguments, closed over the real
ones in `src/adapters.ts`. That is why the tests can check the exact argv handed
to `git` without a network, a clone, or `git` installed.

---

Kei: <https://keicoin.org>

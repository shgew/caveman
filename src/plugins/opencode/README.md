# caveman — opencode plugin

Native opencode plugin. Full parity port of the Claude Code hook pair
(`SessionStart` = `caveman-activate.js`, `UserPromptSubmit` =
`caveman-mode-tracker.js`) expressed through opencode's verified `Hooks`
interface (`@opencode-ai/plugin`).

## What this ships

| File | Role |
|---|---|
| `plugin.js` | Self-contained ESM module. Exports an opencode `Plugin` factory (named `CavemanPlugin` + default). |
| `package.json` | Marks the directory as ESM (`"type": "module"`, `"main": "plugin.js"`). |
| `commands/*.md` | Six slash-command prompt templates (`/caveman`, `/caveman-commit`, …). |

`plugin.js` is **self-contained**: only `node:` builtins are imported at
runtime, and the SKILL.md ruleset plus all `caveman-config.js` helpers are
**inlined**. It therefore loads correctly from a read-only `/nix/store` path via
a `file://` plugin spec with no install step and no `bun install` — no sibling
`caveman-config.cjs` copy and no `fs`-read of `../skills/caveman/SKILL.md`.

## Hooks → behavior

| opencode hook | Role |
|---|---|
| `event` (`session.created`) | Seed a new session's level from the machine-wide default (`getDefaultMode`). |
| `chat.message` | Read the user's text, parse `/caveman[ <level>]`, `/caveman-commit\|review\|compress`, and natural language ("turn on caveman", "stop caveman", "normal mode"); persist the resolved level. |
| `experimental.chat.system.transform` | Push the level-filtered caveman persona onto `output.system`. opencode rebuilds the system prompt every request, so the persona is re-pushed each turn to stay active. Byte-for-byte identical to `caveman-activate.js` output. |
| `command.execute.before` | Mirror first-class `/caveman*` command-file runs into state (bare and `caveman:`-namespaced names). |

## State

Per-session and writable. The authoritative store is
`$XDG_STATE_HOME/caveman/opencode-state.json` (falls back to
`~/.local/state/caveman/…`), shape `{ "sessions": { "<sessionID>": "<level>" } }`.
A level set in one session **never** leaks into another; the machine-wide
default comes only from `CAVEMAN_DEFAULT_MODE` / `~/.config/caveman/config.json`
(read-only), set deliberately by the user. `/caveman off` stores `off` for that
session so it stays quiet until re-enabled. An optional single-line legacy
mirror is written to `~/.config/opencode/.caveman-active` for external
statusline readers; `opencode-state.json` is canonical. Nothing is ever written
to the plugin's own (possibly read-only) directory.

## Parity gaps (intentional)

- **No statusline badge.** opencode exposes no plugin-writable statusline
  schema. Read `~/.config/opencode/.caveman-active` from your shell prompt if
  you want to surface the mode.
- **No live `/caveman-stats`.** opencode's `chat.message` cannot block/replace a
  prompt and there is no `transcript_path` in the payload. `caveman-stats.md` is
  kept for discoverability only and no-ops the level switch.

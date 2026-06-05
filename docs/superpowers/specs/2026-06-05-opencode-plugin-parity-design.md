# opencode Plugin Parity Design

## Goal

Add repo-level opencode plugin support that matches Claude parity where opencode supports it: a first-class plugin distribution package in the repository, without inventing an undocumented opencode marketplace manifest.

## Context

Claude Code support has root plugin metadata in `.claude-plugin/` and a mirrored plugin distribution under `plugins/caveman/`. opencode support currently works through `bin/install.js --only opencode`, which copies `src/plugins/opencode/` into the user's opencode config directory, copies commands/agents/skills, writes `AGENTS.md`, and patches `opencode.json` with `./plugins/caveman/plugin.js`.

The current opencode docs support two plugin forms:

- Local JavaScript or TypeScript files under `.opencode/plugins/` or `~/.config/opencode/plugins/`.
- npm packages listed in `opencode.json` under the `plugin` array.

There is no documented `.opencode-plugin/` marketplace manifest equivalent to Claude Code's `.claude-plugin/` directory.

## Design

Create a repo-level opencode plugin distribution package under `plugins/caveman/opencode/`. This package is the opencode-facing distribution artifact, while `src/plugins/opencode/` remains the installer source of truth.

The distribution package includes:

- `package.json` with package metadata suitable for opencode's npm plugin loading model.
- `plugin.js`, copied from `src/plugins/opencode/plugin.js`.
- `caveman-config.cjs`, copied from `src/hooks/caveman-config.js`, preserving the installed plugin's CommonJS bridge behavior.
- `README.md` explaining how users can reference the package locally or publish/use it through opencode's `plugin` config field.

The package name is `@juliusbrussee/opencode-caveman`, avoiding the known third-party `opencode-caveman` npm name collision.

Do not add a root `.opencode-plugin/` directory or `plugin.json` unless opencode documents such a format later.

## Installer Behavior

Do not replace the current native installer path in this change. `bin/install.js --only opencode` should continue installing from `src/plugins/opencode/` into `~/.config/opencode/`, preserving current tests and user behavior.

The new package is additive. It gives the repo an opencode plugin artifact analogous to Claude's plugin distribution, but it does not force users through npm or change global config writes.

## Data Flow

At implementation time, the repo will have two opencode plugin locations:

1. `src/plugins/opencode/` for installer-managed local installation.
2. `plugins/caveman/opencode/` for opencode plugin distribution/package parity.

Both load the same runtime plugin logic. The runtime plugin continues to:

- Resolve the opencode config directory.
- Write/read `.caveman-active` through `safeWriteFlag` and `readFlag`.
- Handle `session.created` and `tui.prompt.append` lifecycle hooks.
- Parse slash commands and natural-language activation/deactivation.

## Error Handling

No new runtime error handling is needed. The existing plugin behavior remains silent on filesystem failures where session startup should not be blocked.

The implementation should avoid symlinks in the distribution package so tests and npm/package consumers receive real files. If sync/copy scripts are added, they should fail fast when a source file is missing.

## Documentation

Update maintainer/user docs to reflect the new parity boundary:

- `CLAUDE.md`: mention `plugins/caveman/opencode/` as the opencode distribution package and clarify that `src/plugins/opencode/` remains the installer source.
- `INSTALL.md`: keep the existing `--only opencode` install command, and add a concise note that advanced users can load the repo-level opencode plugin package through opencode's `plugin` config model.
- `src/plugins/opencode/README.md`: replace the current "no separate npm package" rationale with the new distribution-package story.

## Testing

Add failing tests before implementation for:

- Distribution package files exist under `plugins/caveman/opencode/`.
- `plugins/caveman/opencode/package.json` has a non-colliding scoped package name, ESM type, and main entry.
- The distribution plugin can be imported and handles `/caveman ultra`, `stop caveman`, and `session.created` the same way as the installer plugin smoke test.
- Existing opencode installer tests still pass unchanged.

## Out Of Scope

- Publishing to npm.
- Replacing `bin/install.js --only opencode` with an opencode registry/CLI install command.
- Adding undocumented opencode marketplace metadata.
- Adding opencode statusline support; opencode still exposes no plugin-writable badge.

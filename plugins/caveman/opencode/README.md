# @juliusbrussee/opencode-caveman

Repo-level opencode plugin distribution for caveman.

Normal users should install through the unified installer:

```bash
npx -y github:JuliusBrussee/caveman -- --only opencode
```

That installer copies the plugin, commands, agents, skills, and `AGENTS.md` ruleset into the opencode config directory.

## Local plugin use

From a clone, opencode can load the plugin file directly through `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/caveman/plugins/caveman/opencode/plugin.js"]
}
```

Replace the path with the absolute path to this checkout.

## npm package use

If this package is published, opencode can load it by package name:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@juliusbrussee/opencode-caveman"]
}
```

Publishing is not part of the repo-local installer. The package name is scoped to avoid the existing third-party `opencode-caveman` package.

## Runtime behavior

The plugin mirrors the installer-managed opencode plugin:

- `session.created` writes the configured default caveman mode.
- `tui.prompt.append` handles `/caveman`, `/caveman <level>`, and natural-language activation or deactivation.
- Active non-independent modes append a short reinforcement line to each prompt.

No statusline badge is provided because opencode does not expose a plugin-writable statusline.

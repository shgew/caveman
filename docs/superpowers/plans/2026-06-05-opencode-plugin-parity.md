# opencode Plugin Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-level opencode plugin distribution package that provides opencode plugin parity without changing the existing installer path.

**Architecture:** Keep `src/plugins/opencode/` as the installer source of truth. Add `plugins/caveman/opencode/` as the opencode-facing distribution package, with copied runtime files and package metadata. Protect the mirror with tests that compare distribution files to their source files.

**Tech Stack:** Node.js `node:test`, ESM opencode plugin module, CommonJS helper bridge, Markdown docs, JSON package metadata.

---

## File Structure

- Modify: `tests/installer/opencode.test.mjs` to add package existence, package metadata, source-mirror, runtime smoke, and docs coverage tests.
- Create: `plugins/caveman/opencode/package.json` for the opencode plugin distribution package metadata.
- Create: `plugins/caveman/opencode/plugin.js` copied byte-for-byte from `src/plugins/opencode/plugin.js`.
- Create: `plugins/caveman/opencode/caveman-config.cjs` copied byte-for-byte from `src/hooks/caveman-config.js`.
- Create: `plugins/caveman/opencode/README.md` explaining local and npm-style opencode plugin usage.
- Modify: `src/plugins/opencode/README.md` to describe the new distribution package instead of saying there is no separate package.
- Modify: `CLAUDE.md` to list the new package in layout, ownership, sync, and agent-distribution notes.
- Modify: `INSTALL.md` to keep the installer command and add an advanced opencode package note.

Do not commit during execution unless the user explicitly requests it. If commits are explicitly requested later, commit after each green task using the commands shown in the task checkpoints.

## Task 1: Add Failing Distribution Package Tests

**Files:**
- Modify: `tests/installer/opencode.test.mjs:17-54`
- Test: `tests/installer/opencode.test.mjs`

- [ ] **Step 1: Add package-path constant and failing tests**

Insert this constant after `const SETTINGS = ...` near line 21:

```js
const OPENCODE_DIST = path.join(REPO_ROOT, 'plugins', 'caveman', 'opencode');
```

Insert these tests after `pathWith()` and before the current first install test:

```js
// ── 0. Repo-level opencode plugin distribution ───────────────────────────
test('opencode distribution package exposes npm-compatible plugin files', () => {
  for (const file of ['package.json', 'plugin.js', 'caveman-config.cjs', 'README.md']) {
    assert.ok(fs.existsSync(path.join(OPENCODE_DIST, file)), `distribution ${file} missing`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(OPENCODE_DIST, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@juliusbrussee/opencode-caveman');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'plugin.js');
  assert.notEqual(pkg.private, true, 'distribution package should not be marked private');
  assert.deepEqual(pkg.files, ['plugin.js', 'caveman-config.cjs', 'README.md']);

  const sourcePlugin = fs.readFileSync(path.join(REPO_ROOT, 'src', 'plugins', 'opencode', 'plugin.js'), 'utf8');
  const distPlugin = fs.readFileSync(path.join(OPENCODE_DIST, 'plugin.js'), 'utf8');
  assert.equal(distPlugin, sourcePlugin, 'distribution plugin.js should match installer source');

  const sourceConfig = fs.readFileSync(path.join(REPO_ROOT, 'src', 'hooks', 'caveman-config.js'), 'utf8');
  const distConfig = fs.readFileSync(path.join(OPENCODE_DIST, 'caveman-config.cjs'), 'utf8');
  assert.equal(distConfig, sourceConfig, 'distribution caveman-config.cjs should match shared config source');
});

test('opencode distribution package plugin handles caveman mode hooks', async () => {
  const xdg = freshTmpDir();
  const oldXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = xdg;
    const pluginPath = path.join(OPENCODE_DIST, 'plugin.js');
    const flagPath = path.join(xdg, 'opencode', '.caveman-active');

    const mod = await import(pathToFileURL(pluginPath).href);
    const factory = mod.default || mod.CavemanPlugin;
    const handlers = await factory({});

    const out1 = await handlers['tui.prompt.append']({ prompt: '/caveman ultra' });
    assert.equal(fs.readFileSync(flagPath, 'utf8'), 'ultra');
    assert.ok(out1 && typeof out1.append === 'string', 'expected reinforcement append');
    assert.match(out1.append, /CAVEMAN MODE ACTIVE \(ultra\)/);

    const out2 = await handlers['tui.prompt.append']({ prompt: 'stop caveman please' });
    assert.equal(fs.existsSync(flagPath), false, 'flag should be deleted after deactivation');
    assert.equal(out2, undefined, 'no reinforcement when flag absent');

    await handlers['session.created']();
    assert.equal(fs.readFileSync(flagPath, 'utf8'), 'full');
  } finally {
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldXdg;
    fs.rmSync(xdg, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/installer/opencode.test.mjs`

Expected: FAIL with `distribution package.json missing` or another `distribution <file> missing` assertion.

- [ ] **Step 3: Checkpoint only**

Run: `git diff -- tests/installer/opencode.test.mjs`

Expected: Diff shows only the new constant and two tests.

If commits were explicitly requested before execution, run: `git add tests/installer/opencode.test.mjs && git commit -m "test: cover opencode plugin package"`.

## Task 2: Add opencode Distribution Package

**Files:**
- Create: `plugins/caveman/opencode/package.json`
- Create: `plugins/caveman/opencode/plugin.js`
- Create: `plugins/caveman/opencode/caveman-config.cjs`
- Create: `plugins/caveman/opencode/README.md`
- Test: `tests/installer/opencode.test.mjs`

- [ ] **Step 1: Add package metadata**

Create `plugins/caveman/opencode/package.json` with this content:

```json
{
  "name": "@juliusbrussee/opencode-caveman",
  "version": "0.1.0",
  "description": "caveman plugin for opencode: terse mode tracking and slash commands",
  "type": "module",
  "main": "plugin.js",
  "exports": "./plugin.js",
  "license": "MIT",
  "author": {
    "name": "Julius Brussee",
    "url": "https://github.com/JuliusBrussee"
  },
  "homepage": "https://github.com/JuliusBrussee/caveman",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/JuliusBrussee/caveman.git",
    "directory": "plugins/caveman/opencode"
  },
  "bugs": {
    "url": "https://github.com/JuliusBrussee/caveman/issues"
  },
  "keywords": [
    "opencode",
    "plugin",
    "caveman",
    "brevity",
    "productivity"
  ],
  "files": [
    "plugin.js",
    "caveman-config.cjs",
    "README.md"
  ],
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Add mirrored runtime files**

Create `plugins/caveman/opencode/plugin.js` with the exact current contents of `src/plugins/opencode/plugin.js`.

Create `plugins/caveman/opencode/caveman-config.cjs` with the exact current contents of `src/hooks/caveman-config.js`.

Do not symlink these files. The test in Task 1 compares exact file bytes and will catch drift.

- [ ] **Step 3: Add package README**

Create `plugins/caveman/opencode/README.md` with this content:

````md
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
````

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/installer/opencode.test.mjs`

Expected: PASS for the new distribution package tests. If another existing opencode test fails, fix it before continuing.

- [ ] **Step 5: Checkpoint only**

Run: `git diff -- tests/installer/opencode.test.mjs plugins/caveman/opencode`

Expected: Diff shows package metadata, README, copied runtime files, and tests.

If commits were explicitly requested before execution, run: `git add tests/installer/opencode.test.mjs plugins/caveman/opencode && git commit -m "feat: add opencode plugin package"`.

## Task 3: Add Failing Documentation Coverage Test

**Files:**
- Modify: `tests/installer/opencode.test.mjs`
- Test: `tests/installer/opencode.test.mjs`

- [ ] **Step 1: Add docs coverage test**

Insert this test after the two distribution package tests added in Task 1:

```js
test('opencode docs describe distribution package parity', () => {
  const claudeMd = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /plugins\/caveman\/opencode/);
  assert.match(claudeMd, /@juliusbrussee\/opencode-caveman/);

  const installMd = fs.readFileSync(path.join(REPO_ROOT, 'INSTALL.md'), 'utf8');
  assert.match(installMd, /@juliusbrussee\/opencode-caveman/);
  assert.match(installMd, /file:\/\/\/absolute\/path\/to\/caveman\/plugins\/caveman\/opencode\/plugin\.js/);

  const sourceReadme = fs.readFileSync(path.join(REPO_ROOT, 'src', 'plugins', 'opencode', 'README.md'), 'utf8');
  assert.match(sourceReadme, /plugins\/caveman\/opencode/);
  assert.match(sourceReadme, /@juliusbrussee\/opencode-caveman/);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/installer/opencode.test.mjs`

Expected: FAIL in `opencode docs describe distribution package parity` because the docs do not yet mention `plugins/caveman/opencode` and `@juliusbrussee/opencode-caveman` everywhere required.

## Task 4: Update Documentation

**Files:**
- Modify: `CLAUDE.md:62-116,236-253`
- Modify: `INSTALL.md:34-80,120-134,234-243`
- Modify: `src/plugins/opencode/README.md:42-46`
- Test: `tests/installer/opencode.test.mjs`

- [ ] **Step 1: Update `CLAUDE.md` layout and ownership docs**

Apply these text changes:

```md
├── plugins/caveman/             # Claude Code + opencode plugin distributions
│   ├── skills/                  # ← from skills/
│   ├── agents/                  # ← from agents/
│   └── opencode/                # opencode package distribution
```

Add this row to the synced-files table:

```md
| `plugins/caveman/opencode/plugin.js` | `src/plugins/opencode/plugin.js` |
| `plugins/caveman/opencode/caveman-config.cjs` | `src/hooks/caveman-config.js` |
```

Add this ownership note near the existing opencode source rows:

```md
| `plugins/caveman/opencode/` | opencode plugin distribution package named `@juliusbrussee/opencode-caveman`. Mirrors `src/plugins/opencode/plugin.js` and `src/hooks/caveman-config.js`; do not edit mirrored runtime files directly. |
```

Update the opencode agent-distribution row so it includes this sentence:

```md
Repo-level package parity lives at `plugins/caveman/opencode/` as `@juliusbrussee/opencode-caveman`; the installer still uses `src/plugins/opencode/` for local managed installs.
```

- [ ] **Step 2: Update `INSTALL.md` opencode notes**

Keep the existing opencode row command unchanged. Add this paragraph after the per-agent install table:

```md
Advanced opencode package path: this repo also ships `plugins/caveman/opencode/`, package name `@juliusbrussee/opencode-caveman`. Normal users should use `--only opencode` because it installs the plugin plus commands, agents, skills, and `AGENTS.md`. From a clone, opencode can load the package plugin directly with `"plugin": ["file:///absolute/path/to/caveman/plugins/caveman/opencode/plugin.js"]`; if the package is published later, use `"plugin": ["@juliusbrussee/opencode-caveman"]`.
```

Update the Privacy network paragraph to mention that the repo-local package path does not add network access:

```md
Loading `plugins/caveman/opencode/` from a local clone does not add a network request; publishing or npm installation of `@juliusbrussee/opencode-caveman` would use npm like any other opencode package plugin.
```

- [ ] **Step 3: Update `src/plugins/opencode/README.md` distribution section**

Replace the `## Why no separate npm package` section with:

```md
## Distribution package

`src/plugins/opencode/` remains the installer source of truth. The repo-level
opencode package lives at `plugins/caveman/opencode/` with package name
`@juliusbrussee/opencode-caveman`.

That package mirrors `plugin.js` and `caveman-config.cjs` as real files so
opencode can load caveman through local file/package plugin paths. We do not
add a `.opencode-plugin` manifest because opencode documents plugin files and
npm packages, not a Claude-style marketplace manifest.
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/installer/opencode.test.mjs`

Expected: PASS for the docs coverage test and prior package tests.

- [ ] **Step 5: Checkpoint only**

Run: `git diff -- CLAUDE.md INSTALL.md src/plugins/opencode/README.md tests/installer/opencode.test.mjs`

Expected: Diff shows docs text plus the docs coverage test.

If commits were explicitly requested before execution, run: `git add CLAUDE.md INSTALL.md src/plugins/opencode/README.md tests/installer/opencode.test.mjs && git commit -m "docs: document opencode plugin package"`.

## Task 5: Full Verification

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run installer test suite**

Run: `npm test`

Expected: All `tests/installer/*.test.mjs` tests pass with exit code 0.

- [ ] **Step 2: Verify package mirror directly**

Run: `cmp -s src/plugins/opencode/plugin.js plugins/caveman/opencode/plugin.js && cmp -s src/hooks/caveman-config.js plugins/caveman/opencode/caveman-config.cjs`

Expected: Exit code 0.

- [ ] **Step 3: Inspect final diff**

Run: `git diff --stat && git diff -- tests/installer/opencode.test.mjs plugins/caveman/opencode CLAUDE.md INSTALL.md src/plugins/opencode/README.md`

Expected: Diff includes only intended tests, package files, docs, and the previously approved spec/plan files.

- [ ] **Step 4: Final status**

Run: `git status --short`

Expected: Changed files are limited to the opencode package parity work and superpowers spec/plan docs.

If commits were explicitly requested before execution, run: `git add tests/installer/opencode.test.mjs plugins/caveman/opencode CLAUDE.md INSTALL.md src/plugins/opencode/README.md docs/superpowers/specs/2026-06-05-opencode-plugin-parity-design.md docs/superpowers/plans/2026-06-05-opencode-plugin-parity.md && git commit -m "feat: add opencode plugin parity"`.

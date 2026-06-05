// caveman — opencode plugin (self-contained ESM)
//
// Full parity port of the Claude Code SessionStart + UserPromptSubmit hook pair
// (caveman-activate.js + caveman-mode-tracker.js), expressed through opencode's
// verified Hooks interface (packages/plugin/src/index.ts).
//
// Mapping:
//   Claude SessionStart            → plugin body (process-start init) +
//                                     event(session.created) for per-session init +
//                                     experimental.chat.system.transform (persona inject)
//   Claude UserPromptSubmit        → chat.message (read user text, parse switches,
//                                     persist) + experimental.chat.system.transform
//                                     (re-push persona every turn) + command.execute.before
//                                     (first-class /caveman* command files)
//
// SELF-CONTAINED by design — loads correctly from a read-only /nix/store path via
// file:// with NO install-time copy step and NO `bun install`:
//   * Zero runtime bare npm imports — only node: builtins.
//   * The SKILL.md ruleset is INLINED as SKILL_BODY (the store path is read-only
//     and the sibling skills/ tree is not guaranteed to be copied alongside the
//     plugin, so we never fs-read ../skills/caveman/SKILL.md).
//   * All caveman-config.js helpers (getConfigDir/getConfigPath/getDefaultMode,
//     safeWriteFlag/readFlag) are INLINED — no createRequire of a sibling .cjs.
//   * Authoritative state lives in a WRITABLE, namespaced dir
//     (XDG_STATE_HOME/caveman), NEVER under this plugin's own directory which may
//     be /nix/store (read-only). We never write to
//     dirname(fileURLToPath(import.meta.url)).
//   * Every filesystem op is wrapped in try/catch with silent fail so a
//     read-only or missing path never throws into opencode.
//
// PARITY GAPS (intentional, no opencode analog):
//   * Statusline setup nudge — opencode has no statusLine settings.json schema
//     equivalent to Claude's and the plugin must not write outside its writable
//     state. Omitted entirely. (See caveman-activate.js step 3.)
//   * /caveman-stats — opencode chat.message cannot block a prompt and replace
//     it with hook output, and there is no documented transcript_path in the
//     payload. We no-op the level switch for /caveman-stats; the caveman-stats.md
//     command file is kept for discoverability only.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_MODES = [
  'off', 'lite', 'full', 'ultra',
  'wenyan-lite', 'wenyan', 'wenyan-full', 'wenyan-ultra',
  'commit', 'review', 'compress',
];

// Modes handled by their own independent skill files (/caveman-commit, etc.) —
// not selectable as a caveman intensity level via /caveman <arg>.
const INDEPENDENT_MODES = new Set(['commit', 'review', 'compress']);

// Inlined, frontmatter-stripped body of skills/caveman/SKILL.md. This is the
// single source of truth for the ruleset — kept verbatim so filterRuleset()
// reproduces caveman-activate.js byte-for-byte. (The plugin never fs-reads
// SKILL.md because the store path is read-only and the skills/ dir is not
// guaranteed to be copied next to the plugin.)
const SKILL_BODY = `Respond terse like smart caveman. All technical substance stay. Only fluff die.

## Persistence

ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure. Off only: "stop caveman" / "normal mode".

Default: **full**. Switch: \`/caveman lite|full|ultra\`.

## Rules

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.

Pattern: \`[thing] [action] [reason]. [next step].\`

Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Yes: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"

## Intensity

| Level | What change |
|-------|------------|
| **lite** | No filler/hedging. Keep articles + full sentences. Professional but tight |
| **full** | Drop articles, fragments OK, short synonyms. Classic caveman |
| **ultra** | Abbreviate prose words (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y), one word when one word enough. Code symbols, function names, API names, error strings: never abbreviate |
| **wenyan-lite** | Semi-classical. Drop filler/hedging but keep grammar structure, classical register |
| **wenyan-full** | Maximum classical terseness. Fully 文言文. 80-90% character reduction. Classical sentence patterns, verbs precede objects, subjects often omitted, classical particles (之/乃/為/其) |
| **wenyan-ultra** | Extreme abbreviation while keeping classical Chinese feel. Maximum compression, ultra terse |

Example — "Why React component re-render?"
- lite: "Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."
- full: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."
- ultra: "Inline obj prop → new ref → re-render. \`useMemo\`."
- wenyan-lite: "組件頻重繪，以每繪新生對象參照故。以 useMemo 包之。"
- wenyan-full: "物出新參照，致重繪。useMemo .Wrap之。"
- wenyan-ultra: "新參照→重繪。useMemo Wrap。"

Example — "Explain database connection pooling."
- lite: "Connection pooling reuses open connections instead of creating new ones per request. Avoids repeated handshake overhead."
- full: "Pool reuse open DB connections. No new connection per request. Skip handshake overhead."
- ultra: "Pool = reuse DB conn. Skip handshake → fast under load."
- wenyan-full: "池reuse open connection。不每req新開。skip handshake overhead。"
- wenyan-ultra: "池reuse conn。skip handshake → fast。"

## Auto-Clarity

Drop caveman when:
- Security warnings
- Irreversible action confirmations
- Multi-step sequences where fragment order or omitted conjunctions risk misread
- Compression itself creates technical ambiguity (e.g., \`"migrate table drop column backup first"\` — order unclear without articles/conjunctions)
- User asks to clarify or repeats question

Resume caveman after clear part done.

Example — destructive op:
> **Warning:** This will permanently delete all rows in the \`users\` table and cannot be undone.
> \`\`\`sql
> DROP TABLE users;
> \`\`\`
> Caveman resume. Verify backup exist first.

## Boundaries

Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert. Level persist until changed or session end.`;

// Defensive hardcoded fallback ruleset (the standalone-install fallback from
// caveman-activate.js lines 95-110). Because SKILL_BODY is always inlined, the
// primary path never needs this — it is dead-code-safe and kept only so the
// builder can externalize the ruleset later without losing the fallback. The
// {LABEL} placeholder is substituted at render time.
const FALLBACK_RULESET =
  'Respond terse like smart caveman. All technical substance stay. Only fluff die.\n\n' +
  '## Persistence\n\n' +
  'ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure. Off only: "stop caveman" / "normal mode".\n\n' +
  'Current level: **{LABEL}**. Switch: `/caveman lite|full|ultra`.\n\n' +
  '## Rules\n\n' +
  'Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. ' +
  'Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged. Errors quoted exact.\n\n' +
  'Pattern: `[thing] [action] [reason]. [next step].`\n\n' +
  'Not: "Sure! I\'d be happy to help you with that. The issue you\'re experiencing is likely caused by..."\n' +
  'Yes: "Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:"\n\n' +
  '## Auto-Clarity\n\n' +
  'Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats question. Resume caveman after clear part done.\n\n' +
  '## Boundaries\n\n' +
  'Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert. Level persist until changed or session end.';

// ---------------------------------------------------------------------------
// Config resolution (READ-ONLY — copied verbatim from caveman-config.js).
// These only read env + ~/.config/caveman/config.json, never write, so they
// are nix-store-safe.
// ---------------------------------------------------------------------------

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'caveman');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'caveman'
    );
  }
  return path.join(os.homedir(), '.config', 'caveman');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function getDefaultMode() {
  // 1. Environment variable (highest priority)
  const envMode = process.env.CAVEMAN_DEFAULT_MODE;
  if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
    return envMode.toLowerCase();
  }

  // 2. Config file
  try {
    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.defaultMode && VALID_MODES.includes(config.defaultMode.toLowerCase())) {
      return config.defaultMode.toLowerCase();
    }
  } catch (e) {
    // Config file doesn't exist or is invalid — fall through
  }

  // 3. Default
  return 'full';
}

// ---------------------------------------------------------------------------
// Legacy flag mirror (symlink-safe — copied verbatim from caveman-config.js).
// Only used for the OPTIONAL single-line ~/.config/opencode/.caveman-active
// mirror so an external statusline reader still works. The authoritative state
// is the JSON file (loadState/saveState below). Both write under writable home
// dirs — never the plugin's own (possibly /nix/store) directory.
// ---------------------------------------------------------------------------

function safeWriteFlag(flagPath, content) {
  const debug = process.env.CAVEMAN_DEBUG === '1';
  try {
    const flagDir = path.dirname(flagPath);
    fs.mkdirSync(flagDir, { recursive: true });

    let realFlagDir;
    try {
      const lstat = fs.lstatSync(flagDir);
      if (lstat.isSymbolicLink()) {
        realFlagDir = fs.realpathSync(flagDir);
        const realStat = fs.statSync(realFlagDir);
        if (!realStat.isDirectory()) {
          if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${realFlagDir} is not a directory\n`);
          return;
        }
        if (typeof process.getuid === 'function') {
          if (realStat.uid !== process.getuid()) {
            if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${realFlagDir} owned by uid ${realStat.uid}, not current user ${process.getuid()}\n`);
            return;
          }
        } else {
          const home = os.homedir();
          const normalizedReal = path.resolve(realFlagDir);
          const normalizedHome = path.resolve(home);
          if (!normalizedReal.toLowerCase().startsWith(normalizedHome.toLowerCase() + path.sep) &&
              normalizedReal.toLowerCase() !== normalizedHome.toLowerCase()) {
            if (debug) process.stderr.write(`[caveman] safeWriteFlag: symlink target ${normalizedReal} is outside home directory ${normalizedHome}\n`);
            return;
          }
        }
      } else {
        realFlagDir = flagDir;
      }
    } catch (e) {
      return;
    }

    const realFlagPath = path.join(realFlagDir, path.basename(flagPath));
    try {
      if (fs.lstatSync(realFlagPath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const tempPath = path.join(realFlagDir, `.caveman-active.${process.pid}.${Date.now()}`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tempPath, flags, 0o600);
      fs.writeSync(fd, String(content));
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tempPath, realFlagPath);
  } catch (e) {
    // Silent fail — flag is best-effort
  }
}

const MAX_FLAG_BYTES = 64;

function readFlag(flagPath) {
  try {
    let st;
    try {
      st = fs.lstatSync(flagPath);
    } catch (e) {
      return null;
    }
    if (st.isSymbolicLink() || !st.isFile()) return null;
    if (st.size > MAX_FLAG_BYTES) return null;

    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd;
    let out;
    try {
      fd = fs.openSync(flagPath, flags);
      const buf = Buffer.alloc(MAX_FLAG_BYTES);
      const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0);
      out = buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const raw = out.trim().toLowerCase();
    if (!VALID_MODES.includes(raw)) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// opencode config dir (writable) — for the OPTIONAL legacy flag mirror only.
// ---------------------------------------------------------------------------

function opencodeConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'opencode');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'opencode'
    );
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

const LEGACY_FLAG_PATH = path.join(opencodeConfigDir(), '.caveman-active');

// ---------------------------------------------------------------------------
// Authoritative writable state — JSON file in a WRITABLE, namespaced dir.
// NEVER under the plugin's own (potentially /nix/store) directory.
// Format: { "sessions": { "<sessionID>": "ultra" | "off" | ... } }
// ---------------------------------------------------------------------------

function stateDir() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'caveman');
}

const STATE_DIR = stateDir();
const STATE_FILE = path.join(STATE_DIR, 'opencode-state.json');

// Module-scope hot path. Survives across messages/sessions within ONE running
// opencode process; mirrored to STATE_FILE for restart durability. State is
// strictly per-session — a level set in one session never leaks into another.
const sessionLevel = new Map(); // Map<sessionID, level> (level may be 'off')

function levelFor(sessionID) {
  if (sessionID && sessionLevel.has(sessionID)) return sessionLevel.get(sessionID);
  // Unseen session: fall back to the machine-wide DEFAULT (env/config), never a
  // mutable runtime global. getDefaultMode() returns 'full' unless configured.
  return getDefaultMode();
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const j = JSON.parse(raw);
    sessionLevel.clear();
    if (j && j.sessions && typeof j.sessions === 'object') {
      for (const [k, v] of Object.entries(j.sessions)) {
        if (typeof v === 'string' && VALID_MODES.includes(v)) sessionLevel.set(k, v);
      }
    }
  } catch (e) {
    // ENOENT / parse error — start fresh, silent.
  }
}

function saveState() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const payload = { sessions: Object.fromEntries(sessionLevel) };
    fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  } catch (e) {
    // Silent fail — state mirror is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Ruleset filtering — the two SKILL regex filters from caveman-activate.js,
// reproduced exactly. Keeps only the active level's intensity-table row and
// only the active level's `- <level>:` example lines.
// ---------------------------------------------------------------------------

function filterRuleset(modeLabel) {
  const filtered = SKILL_BODY.split('\n').reduce((acc, line) => {
    // Intensity table rows start with | **level** |
    const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
    if (tableRowMatch) {
      if (tableRowMatch[1] === modeLabel) acc.push(line);
      return acc;
    }
    // Example lines start with "- level:" — keep only the active level's
    const exampleMatch = line.match(/^- (\S+?):\s/);
    if (exampleMatch) {
      if (exampleMatch[1] === modeLabel) acc.push(line);
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);
  return filtered.join('\n');
}

// Full persona system text for a resolved level. For independent modes, emits
// the single activation line; for intensity levels, emits the filtered ruleset.
// Mirrors caveman-activate.js output byte-for-byte.
function personaText(level) {
  if (!level || level === 'off') return null;
  if (INDEPENDENT_MODES.has(level)) {
    return 'CAVEMAN MODE ACTIVE — level: ' + level +
      '. Behavior defined by /caveman-' + level + ' skill.';
  }
  // wenyan alias normalizes to wenyan-full for SKILL filtering
  // (caveman-activate.js line 48).
  const modeLabel = level === 'wenyan' ? 'wenyan-full' : level;
  return 'CAVEMAN MODE ACTIVE — level: ' + modeLabel + '\n\n' + filterRuleset(modeLabel);
}

// ---------------------------------------------------------------------------
// Prompt parsing — slash commands + natural language. Mirrors
// caveman-mode-tracker.js. Returns the new mode to set, 'off' to deactivate,
// or null to leave state untouched.
// ---------------------------------------------------------------------------

function parseModeChange(promptRaw) {
  const prompt = (promptRaw || '').trim().toLowerCase();
  if (!prompt) return null;

  // 2. /caveman-stats — opencode cannot block/inject stats, so no-op the
  //    level switch. Detected so it doesn't fall through into slash parsing.
  if (/^\/caveman(?::caveman)?-stats(?:\s+(.*))?$/.test(prompt)) {
    return null;
  }

  // 1. Natural-language ACTIVATION (applied first; may be overridden by
  //    deactivation below). Activation requires no co-occurring stop token.
  let activationMode = null;
  if ((/\b(activate|enable|turn on|start|talk like)\b.*\bcaveman\b/i.test(prompt) ||
       /\bcaveman\b.*\b(mode|activate|enable|turn on|start)\b/i.test(prompt)) &&
      !/\b(stop|disable|turn off|deactivate)\b/i.test(prompt)) {
    const m = getDefaultMode();
    if (m !== 'off') activationMode = m;
  }

  // 3. SLASH COMMANDS.
  let slashMode = null;
  if (prompt.startsWith('/caveman')) {
    const parts = prompt.split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] || '';

    if (cmd === '/caveman-commit') {
      slashMode = 'commit';
    } else if (cmd === '/caveman-review') {
      slashMode = 'review';
    } else if (cmd === '/caveman-compress' || cmd === '/caveman:caveman-compress') {
      slashMode = 'compress';
    } else if (cmd === '/caveman' || cmd === '/caveman:caveman') {
      if (!arg) {
        slashMode = getDefaultMode();
      } else if (arg === 'off' || arg === 'stop' || arg === 'disable') {
        slashMode = 'off';
      } else if (arg === 'wenyan-full') {
        slashMode = 'wenyan'; // config stores canonical alias
      } else if (VALID_MODES.includes(arg) && !INDEPENDENT_MODES.has(arg)) {
        slashMode = arg;
      }
      // Unknown arg → slashMode stays null (no silent overwrite).
    }
  }

  // 4. Natural-language DEACTIVATION (override). Runs AFTER activation/slash so
  //    deactivation wins when both appear in one prompt — matches the Claude
  //    tracker, which applies the unconditional unlink last.
  if (/\b(stop|disable|deactivate|turn off)\b.*\bcaveman\b/i.test(prompt) ||
      /\bcaveman\b.*\b(stop|disable|deactivate|turn off)\b/i.test(prompt) ||
      /\bnormal mode\b/i.test(prompt)) {
    return 'off';
  }

  // Slash command takes precedence over a bare natural-language activation when
  // both somehow matched (slash is the explicit instruction).
  if (slashMode !== null) return slashMode;
  return activationMode;
}

// Apply a resolved mode change to the hot-path Map + persisted state. State is
// per-session: a switch in one session never changes another session. 'off' is
// stored explicitly (not deleted) so the session stays quiet until re-enabled,
// rather than falling back to the default. The machine-wide default lives in
// config (getDefaultMode), set deliberately by the user — never by a command.
function applyModeChange(mode, sessionID) {
  if (mode === null || mode === undefined) return;
  if (!sessionID) return; // can't scope a change without a session id

  sessionLevel.set(sessionID, mode);

  if (mode === 'off') {
    try { if (fs.existsSync(LEGACY_FLAG_PATH)) fs.unlinkSync(LEGACY_FLAG_PATH); } catch (e) {}
  } else {
    safeWriteFlag(LEGACY_FLAG_PATH, mode); // optional legacy mirror for statusline readers
  }
  saveState();
}

// ---------------------------------------------------------------------------
// Plugin factory — dual export (named + default). opencode iterates a module's
// exports and treats any exported async function returning a Hooks object as a
// plugin factory; the default export is a belt-and-suspenders fallback.
// ---------------------------------------------------------------------------

export const CavemanPlugin = async (_ctx) => {
  // Plugin body runs ONCE per opencode process (before any session). Load
  // persisted state from the writable XDG state file here.
  loadState();

  return {
    // SessionStart init side-effect. session.created is read-only (cannot inject
    // the prompt), so we only use it to seed per-session state from
    // getDefaultMode(). Persona text is injected later in
    // experimental.chat.system.transform.
    event: async ({ event }) => {
      if (!event || event.type !== 'session.created') return;
      try {
        const sid =
          (event.properties && event.properties.info && event.properties.info.id) ||
          (event.properties && event.properties.sessionID) ||
          (event.properties && event.properties.id) ||
          null;
        if (!sid) return;
        // Seed a brand-new session from the machine-wide default; never clobber
        // a session that already has a persisted level.
        if (!sessionLevel.has(sid)) {
          sessionLevel.set(sid, getDefaultMode());
          saveState();
        }
      } catch (e) {
        // Silent fail — never block session creation.
      }
    },

    // UserPromptSubmit analog: read the user's text parts, parse slash + natural
    // language switches (with deactivation override), persist. Optionally push a
    // user-channel reminder as a redundant fallback for runtimes where
    // experimental.chat.system.transform is unavailable.
    'chat.message': async (input, output) => {
      try {
        const userText = (output.parts || [])
          .filter((p) => p && p.type === 'text')
          .map((p) => p.text ?? '')
          .join('\n');

        const change = parseModeChange(userText);
        if (change !== null) {
          applyModeChange(change, input && input.sessionID);
        }
      } catch (e) {
        // Silent fail — never block the message.
      }
    },

    // Persona injection — the canonical system-prompt injection point. opencode
    // rebuilds output.system fresh every request, so the (level-filtered)
    // persona must be re-pushed every turn to stay active; this is by design,
    // not redundancy. The full ruleset already contains the per-turn reminder
    // text, so no separate reminder line is pushed.
    'experimental.chat.system.transform': async (input, output) => {
      try {
        const level = levelFor(input && input.sessionID);
        if (!level || level === 'off') return;

        const persona = personaText(level);
        if (persona && output && Array.isArray(output.system)) {
          output.system.push(persona);
        }
      } catch (e) {
        // Silent fail — if the hook is absent at runtime opencode ignores the
        // key; chat.message-side handling keeps state in sync regardless.
      }
    },

    // First-class /caveman* command files (command/*.md). Mirror their runs into
    // state so the shipped command templates keep the flag in sync. We parse the
    // synthetic prompt with the SAME parseModeChange logic.
    'command.execute.before': async (input, _output) => {
      try {
        const raw = input && input.command;
        if (!raw) return;
        // Strip a leading plugin namespace (e.g. "caveman:caveman" -> "caveman")
        // so both bare and namespaced command names are handled.
        const cmd = String(raw).replace(/^caveman:/, '');
        if (cmd !== 'caveman' &&
            cmd !== 'caveman-commit' &&
            cmd !== 'caveman-review' &&
            cmd !== 'caveman-compress') {
          return;
        }
        const args = (input && input.arguments) || '';
        const synthetic = '/' + cmd + ' ' + args;
        const change = parseModeChange(synthetic);
        if (change !== null) {
          applyModeChange(change, input && input.sessionID);
        }
      } catch (e) {
        // Silent fail — never block the command.
      }
    },
  };
};

export default CavemanPlugin;

// Silence the unused-import linter for fileURLToPath: kept available so any
// future read-only sibling lookup resolves relative to import.meta.url rather
// than cwd. The recommended self-contained design needs no sibling reads.
void fileURLToPath;

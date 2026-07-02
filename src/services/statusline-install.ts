import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import {
  STATE_DIR,
  SETTINGS_FILE,
  STATUSLINE_CACHE_FILE,
  STATUSLINE_INNER_FILE,
  STATUSLINE_TAP_FILE,
} from './statusline'

/**
 * Install / uninstall the statusline tap.
 *
 * Claude Code reads `statusLine.command` with precedence
 *   local (.claude/settings.local.json) › project (.claude/settings.json) ›
 *   global (~/.claude/settings.json)
 * so installing only globally silently does nothing in a repo that already
 * defines a statusline. The installer wires the tap into the scope Claude
 * actually reads, chaining whatever command is there and recording it so
 * uninstall reverses it exactly.
 *
 * The tap script is copied to ~/.claude/ (a stable path) rather than referenced
 * in the versioned extension directory, whose path changes on every update and
 * would orphan `statusLine.command`.
 */

type Scope = 'global' | 'project' | 'local'

/** Result of an install/uninstall attempt. */
export type InstallResult = { ok: true } | { ok: false; error: string }

interface InnerRecord {
  scope: Scope
  command: string
  workspacePath?: string
}

/**
 * Absolute `node` path resolved at install time. Claude Code runs the command
 * in a shell whose PATH may differ from VS Code's (the nvm case); baking the
 * absolute path makes it work regardless. Falls back to bare "node".
 */
function resolveNodePath(): string {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    const out = execFileSync(finder, ['node'], { encoding: 'utf-8', timeout: 3000 })
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    if (first) {
      return first
    }
  } catch {
    /* detection failed — fall back to PATH lookup at render time */
  }
  return 'node'
}

/** The `statusLine.command` value we install. */
function tapCommand(): string {
  return `"${resolveNodePath()}" "${STATUSLINE_TAP_FILE}"`
}

function settingsPathFor(scope: Scope, workspacePath?: string): string | null {
  if (scope === 'global') {
    return SETTINGS_FILE
  }
  if (!workspacePath) {
    return null
  }
  if (scope === 'project') {
    return path.join(workspacePath, '.claude', 'settings.json')
  }
  return path.join(workspacePath, '.claude', 'settings.local.json')
}

/**
 * `statusLine.command` from one settings file. null = key absent (or file
 * missing/unparseable); "" = present but empty.
 */
function readCommandFromFile(filePath: string | null): string | null {
  if (!filePath) {
    return null
  }
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  let data: { statusLine?: { command?: unknown } }
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const sl = data.statusLine
  if (!sl || typeof sl !== 'object' || !('command' in sl)) {
    return null
  }
  return typeof sl.command === 'string' ? sl.command : null
}

/**
 * Set (or, with `command === null`, remove) `statusLine.command` in a settings
 * file, preserving every other key. Returns false on any IO/parse failure.
 */
function setStatusLineCommand(filePath: string | null, command: string | null): boolean {
  if (!filePath) {
    return false
  }
  let data: Record<string, unknown> = {}
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // missing or unparseable — start from an empty object
  }

  const sl =
    data.statusLine && typeof data.statusLine === 'object'
      ? (data.statusLine as Record<string, unknown>)
      : {}

  if (command === null || command === '') {
    delete sl.command
    if (Object.keys(sl).length === 0) {
      delete data.statusLine
    } else {
      data.statusLine = sl
    }
  } else {
    sl.command = command
    sl.type = sl.type ?? 'command'
    data.statusLine = sl
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
    fs.renameSync(tmp, filePath)
    return true
  } catch {
    return false
  }
}

interface EffectiveScope {
  scope: Scope
  command: string
}

/** Highest-precedence scope that defines statusLine.command (default global). */
function resolveEffectiveScope(workspacePath?: string): EffectiveScope {
  if (workspacePath) {
    const local = readCommandFromFile(settingsPathFor('local', workspacePath))
    if (local !== null) {
      return { scope: 'local', command: local }
    }
    const project = readCommandFromFile(settingsPathFor('project', workspacePath))
    if (project !== null) {
      return { scope: 'project', command: project }
    }
  }
  const global = readCommandFromFile(SETTINGS_FILE)
  if (global !== null) {
    return { scope: 'global', command: global }
  }
  return { scope: 'global', command: '' }
}

function writeInner(rec: InnerRecord): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(STATUSLINE_INNER_FILE, JSON.stringify(rec, null, 2) + '\n')
  } catch {
    /* best-effort */
  }
}

function readInner(): InnerRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATUSLINE_INNER_FILE, 'utf-8')) as Partial<InnerRecord>
    if (parsed.scope !== 'global' && parsed.scope !== 'project' && parsed.scope !== 'local') {
      return null
    }
    return {
      scope: parsed.scope,
      command: typeof parsed.command === 'string' ? parsed.command : '',
      workspacePath: typeof parsed.workspacePath === 'string' ? parsed.workspacePath : undefined,
    }
  } catch {
    return null
  }
}

/** True when the effective statusLine.command points at our tap. */
export function isStatuslineInstalled(workspacePath?: string): boolean {
  return resolveEffectiveScope(workspacePath).command.includes(STATUSLINE_TAP_FILE)
}

/** The `statusline-tap.js` path referenced by a command string, or null. */
export function tapFilePathIn(command: string): string | null {
  if (typeof command !== 'string') {
    return null
  }
  const quoted = command.match(/"([^"]*statusline-tap\.js)"/)
  if (quoted) {
    return quoted[1]
  }
  const bare = command.match(/(\S*statusline-tap\.js)/)
  return bare ? bare[1] : null
}

/** A tap's recorded inner command, read from its sibling statusline-inner.json. */
function readInnerCommandInDir(dir: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'statusline-inner.json'), 'utf-8'))
    return typeof parsed.command === 'string' ? parsed.command : ''
  } catch {
    return ''
  }
}

/**
 * Follow a chain of statusline taps — each records the command it wraps in a
 * sibling statusline-inner.json — and report whether it leads back to OUR tap.
 * Two taps that wrap each other form an infinite render loop; this lets the
 * installer refuse to record (or actively break) an inner command that would
 * close that loop. The reader is injectable for tests; the hop ceiling keeps a
 * malformed or self-referential chain from spinning.
 */
export function commandChainsBackToOurTap(
  command: string,
  readInnerForDir: (dir: string) => string = readInnerCommandInDir,
): boolean {
  let current = command
  for (let hops = 0; hops < 16; hops++) {
    const tapPath = tapFilePathIn(current)
    if (!tapPath) {
      return false // reached a non-tap (real) command — no cycle
    }
    if (path.normalize(tapPath) === path.normalize(STATUSLINE_TAP_FILE)) {
      return true // chain comes back to us
    }
    current = readInnerForDir(path.dirname(tapPath))
  }
  return true // pathologically deep — treat as cyclic
}

/** Clear our tap from every scope except `keep`. */
function clearTapFromOtherScopes(workspacePath?: string, keep?: Scope): void {
  for (const scope of ['global', 'project', 'local'] as Scope[]) {
    if (scope === keep) {
      continue
    }
    const filePath = settingsPathFor(scope, workspacePath)
    const cmd = readCommandFromFile(filePath)
    if (cmd !== null && cmd.includes(STATUSLINE_TAP_FILE)) {
      setStatusLineCommand(filePath, null)
    }
  }
}

/**
 * Install the tap into the effective scope so it actually wins, recording the
 * prior command + scope so uninstall restores it exactly. Idempotent.
 */
export function installStatusline(tapSourcePath: string, workspacePath?: string): InstallResult {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.copyFileSync(tapSourcePath, STATUSLINE_TAP_FILE)

    const eff = resolveEffectiveScope(workspacePath)
    const alreadyOurs = eff.command.includes(STATUSLINE_TAP_FILE)

    if (alreadyOurs) {
      // Self-heal a pre-existing loop: if our recorded inner chains back to our
      // own tap, the real command is unrecoverable — break it to the default
      // line rather than keep spawning forever.
      const inner = readInner()
      if (inner && commandChainsBackToOurTap(inner.command)) {
        writeInner({ scope: inner.scope, command: '', workspacePath: inner.workspacePath })
      }
    } else {
      // Refuse to wrap a foreign tap that already wraps us — recording it as our
      // inner would close an infinite loop. Our tap is already downstream in the
      // chain, so leave the effective command untouched.
      if (commandChainsBackToOurTap(eff.command)) {
        return { ok: true }
      }
      writeInner({ scope: eff.scope, command: eff.command, workspacePath })
    }

    const ok = setStatusLineCommand(settingsPathFor(eff.scope, workspacePath), tapCommand())
    clearTapFromOtherScopes(workspacePath, eff.scope)
    return ok ? { ok: true } : { ok: false, error: 'settings-write-failed' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Re-install silently when the sidecar says "installed" but the effective scope
 * no longer holds our tap (settings reverted by a checkout/merge). Safe to call
 * on every activation — a single fs read when there's nothing to do.
 */
export function selfHealStatusline(tapSourcePath: string, workspacePath?: string): InstallResult {
  if (!readInner()) {
    return { ok: true }
  }
  if (isStatuslineInstalled(workspacePath)) {
    return { ok: true }
  }
  return installStatusline(tapSourcePath, workspacePath)
}

/** Remove the tap and restore the prior command at the recorded scope. */
export function uninstallStatusline(workspacePath?: string): InstallResult {
  try {
    const rec = readInner()
    if (rec) {
      setStatusLineCommand(
        settingsPathFor(rec.scope, rec.workspacePath ?? workspacePath),
        rec.command || null,
      )
    }
    clearTapFromOtherScopes(workspacePath)

    for (const f of [STATUSLINE_INNER_FILE, STATUSLINE_TAP_FILE, STATUSLINE_CACHE_FILE]) {
      try {
        fs.rmSync(f)
      } catch {
        /* already gone — fine */
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

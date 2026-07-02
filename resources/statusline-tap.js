#!/usr/bin/env node
'use strict'

/**
 * Claude Usage Bars — statusline tap.
 *
 * Claude Code runs this as its `statusLine.command`, once per render, as its OWN
 * Node process (never imported by the extension host). On stdin it receives a
 * JSON payload that is the only place the subscription rate-limit / model /
 * context / cost data is exposed WITHOUT the OAuth token. We cache the relevant
 * subset to a local file the extension reads (no network, no token — ToS-safe),
 * then chain the user's original statusline command so their bar is unchanged.
 *
 * Self-contained on purpose: only Node built-ins, copied verbatim to
 * ~/.claude/.claude-usage-bars/. Must never crash the status bar — every failure
 * path still emits a line and exits 0.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const STATE_DIR = path.join(os.homedir(), '.claude', '.claude-usage-bars')
const CACHE_FILE = path.join(STATE_DIR, 'statusline.json')
const INNER_FILE = path.join(STATE_DIR, 'statusline-inner.json')

/**
 * Re-entrancy ceiling. Claude Code runs this once per render, but if two
 * statusline taps end up wrapping each other (each records the other as its
 * inner command) the chain spawns without bound and buries the machine in node
 * processes. We thread a depth counter through the environment — it survives the
 * shell that spawnSync inherits, even across a foreign tap that knows nothing
 * about it — and stop chaining once it crosses the ceiling. A healthy chain ends
 * at the real statusline long before this trips.
 */
const DEPTH_VAR = 'CLAUDE_USAGE_BARS_TAP_DEPTH'
// Our tap legitimately chains exactly once per render (to the real statusline),
// so the first re-entry is already a cycle — stop there.
const MAX_DEPTH = 1

function currentDepth() {
  const n = parseInt(process.env[DEPTH_VAR] || '', 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
function str(v) {
  return typeof v === 'string' ? v : ''
}

/** One rate-limit window from the payload, or null when absent/invalid. */
function rateWindow(raw) {
  if (!raw || typeof raw.used_percentage !== 'number') {
    return null
  }
  return { usedPercent: num(raw.used_percentage), resetsAt: num(raw.resets_at) }
}

/** Map Claude Code's statusline payload to our cache shape. Null if not JSON. */
function extractCache(raw, now) {
  let p
  try {
    p = JSON.parse(raw)
  } catch {
    return null
  }
  if (!p || typeof p !== 'object') {
    return null
  }
  const model = p.model
  const ctx = p.context_window
  const cost = p.cost
  const rl = p.rate_limits

  return {
    capturedAt: now,
    version: str(p.version),
    model:
      model && (model.id != null || model.display_name != null)
        ? { id: str(model.id), displayName: str(model.display_name) }
        : null,
    context:
      ctx && typeof ctx.used_percentage === 'number'
        ? { usedPercent: num(ctx.used_percentage), size: num(ctx.context_window_size) }
        : null,
    cost:
      cost && typeof cost.total_cost_usd === 'number'
        ? {
            totalUsd: num(cost.total_cost_usd),
            durationMs: num(cost.total_duration_ms),
            linesAdded: num(cost.total_lines_added),
            linesRemoved: num(cost.total_lines_removed),
          }
        : null,
    rateLimits: {
      fiveHour: rateWindow(rl && rl.five_hour),
      sevenDay: rateWindow(rl && rl.seven_day),
    },
  }
}

/** Compact fallback line when the user has no original statusline to chain. */
function renderDefaultLine(cache) {
  const parts = []
  if (cache.model && cache.model.displayName) {
    parts.push(cache.model.displayName)
  }
  if (cache.context) {
    parts.push('ctx ' + Math.round(cache.context.usedPercent) + '%')
  }
  const r = cache.rateLimits
  if (r.fiveHour) {
    parts.push('5h ' + Math.round(r.fiveHour.usedPercent) + '%')
  }
  if (r.sevenDay) {
    parts.push('7d ' + Math.round(r.sevenDay.usedPercent) + '%')
  }
  return parts.join('  ')
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

/** Atomic write (tmp + rename) so readers never see a torn file. */
function writeCache(json) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    const tmp = CACHE_FILE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, json)
    fs.renameSync(tmp, CACHE_FILE)
  } catch {
    // A failed cache write must not break the status bar.
  }
}

/** The user's original statusLine.command, recorded by the installer. */
function readInnerCommand() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INNER_FILE, 'utf-8'))
    return typeof parsed.command === 'string' ? parsed.command : ''
  } catch {
    return ''
  }
}

/** Run the chained command with the same stdin and forward its stdout. */
function runInner(command, stdin, depth) {
  if (!command) {
    return null
  }
  if (depth >= MAX_DEPTH) {
    // Cyclic statusline wiring — stop chaining before it forks without bound.
    return null
  }
  try {
    const res = spawnSync(command, {
      shell: true,
      input: stdin,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      env: Object.assign({}, process.env, { [DEPTH_VAR]: String(depth + 1) }),
    })
    if (res.status === 0 && typeof res.stdout === 'string') {
      return res.stdout
    }
  } catch {
    // fall through to default line
  }
  return null
}

function main() {
  const raw = readStdin()
  const cache = extractCache(raw, Date.now())
  if (cache) {
    writeCache(JSON.stringify(cache))
  }

  const chained = runInner(readInnerCommand(), raw, currentDepth())
  if (chained !== null) {
    process.stdout.write(chained)
  } else if (cache) {
    process.stdout.write(renderDefaultLine(cache))
  }
}

main()

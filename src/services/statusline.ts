import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ClaudeUsage } from '../types'

/**
 * Local, ToS-compliant usage source.
 *
 * Anthropic restricts the subscription OAuth credential to the official Claude
 * Code client, so a third-party tool calling the usage endpoint with that token
 * violates the Consumer Terms (and is what got the API-based version of this
 * extension taken down). The compliant path: let Claude Code — the authorized
 * client — fetch the data and hand it to its `statusLine.command` on stdin every
 * render; we install a tap as that command which caches the rate-limit / model /
 * context / cost subset to a local file. This module just reads that file —
 * pure local IO, no network, no token.
 *
 * Freshness: the cache is only as current as Claude Code's last statusline
 * render. During an active session it updates every turn (effectively live);
 * when idle it holds the last-seen values. Callers surface `capturedAt` so the
 * UI can show "as of HH:MM" rather than implying a fresh server reading.
 */

/** Root Claude CLI data directory (~/.claude). */
export const CLAUDE_DIR = path.join(os.homedir(), '.claude')

/** Global Claude CLI settings file. */
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json')

/** Our own state directory under ~/.claude (survives extension updates). */
export const STATE_DIR = path.join(CLAUDE_DIR, '.claude-usage-bars')

/** Cache the tap writes on every statusline render. */
export const STATUSLINE_CACHE_FILE = path.join(STATE_DIR, 'statusline.json')

/** The copied tap script Claude Code runs as `statusLine.command`. */
export const STATUSLINE_TAP_FILE = path.join(STATE_DIR, 'statusline-tap.js')

/** Sidecar recording the user's original statusLine command + scope. */
export const STATUSLINE_INNER_FILE = path.join(STATE_DIR, 'statusline-inner.json')

/** A single rolling rate-limit window as the tap caches it. */
interface RateWindow {
  /** Percentage 0–100 of the window's cap consumed. */
  usedPercent: number
  /** Epoch seconds when the window resets, or 0 when unknown. */
  resetsAt: number
}

/** The subset the tap caches from Claude Code's statusline payload. */
export interface StatuslineCache {
  /** Epoch ms when Claude Code last rendered the statusline (cache write). */
  capturedAt: number
  version: string
  model: { id: string; displayName: string } | null
  context: { usedPercent: number; size: number } | null
  cost: {
    totalUsd: number
    durationMs: number
    linesAdded: number
    linesRemoved: number
  } | null
  rateLimits: {
    fiveHour: RateWindow | null
    sevenDay: RateWindow | null
  }
}

/** Extra live-session fields the tooltip can surface beyond rate limits. */
export interface LiveSession {
  model: string
  contextUsedPercent: number | null
  contextSize: number | null
  sessionCostUsd: number | null
  /** ISO time Claude Code last rendered the statusline. */
  capturedAt: string
}

export interface LocalUsage {
  /** Mapped into the existing ClaudeUsage shape so the UI is unchanged. */
  usage: ClaudeUsage
  live: LiveSession
}

/** Read + parse the tap's cache file. Null when absent or malformed. */
export function readStatuslineCache(): StatuslineCache | null {
  let raw: string
  try {
    raw = fs.readFileSync(STATUSLINE_CACHE_FILE, 'utf-8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as StatuslineCache) : null
  } catch {
    return null
  }
}

/** Epoch-seconds reset → ISO string; 0/unknown → null (matches UsageWindow). */
function toIso(resetsAtSeconds: number): string | null {
  return resetsAtSeconds > 0 ? new Date(resetsAtSeconds * 1000).toISOString() : null
}

/**
 * Read the latest usage from the local statusline cache, mapped into the
 * existing `ClaudeUsage` shape. Returns null when there's no usable cache yet
 * (tap not installed, or Claude Code hasn't rendered a statusline). The Opus
 * window has no statusline equivalent, so it's simply omitted.
 */
export function readLocalUsage(): LocalUsage | null {
  const cache = readStatuslineCache()
  if (!cache) {
    return null
  }

  const usage: ClaudeUsage = {}
  const five = cache.rateLimits?.fiveHour
  const seven = cache.rateLimits?.sevenDay
  if (five) {
    usage.five_hour = { utilization: five.usedPercent, resets_at: toIso(five.resetsAt) }
  }
  if (seven) {
    usage.seven_day = { utilization: seven.usedPercent, resets_at: toIso(seven.resetsAt) }
  }

  const capturedAt = Number.isFinite(cache.capturedAt)
    ? new Date(cache.capturedAt).toISOString()
    : ''

  return {
    usage,
    live: {
      model: cache.model?.displayName ?? '',
      contextUsedPercent: cache.context?.usedPercent ?? null,
      contextSize: cache.context?.size ?? null,
      sessionCostUsd: cache.cost?.totalUsd ?? null,
      capturedAt,
    },
  }
}

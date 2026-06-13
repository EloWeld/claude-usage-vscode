import * as vscode from 'vscode'
import { ClaudeUsage } from '../types'

/**
 * Lightweight usage analytics. Records periodic snapshots of session/weekly
 * utilization into the extension's global storage, keeps roughly a day of
 * history, and derives a burn rate (how fast the limit is being consumed).
 */

const KEY = 'claudeUsage.history'
const WINDOW_MS = 24 * 60 * 60 * 1000 // keep ~1 day
const MIN_GAP_MS = 60 * 1000 // collapse points recorded within 1 minute

export interface UsagePoint {
  /** Epoch milliseconds. */
  t: number
  /** Session (5h) utilization percent. */
  s: number
  /** Weekly (7d) utilization percent. */
  w: number
}

let store: vscode.Memento | undefined

export function initHistory(memento: vscode.Memento) {
  store = memento
}

export function getHistory(): UsagePoint[] {
  return store?.get<UsagePoint[]>(KEY, []) ?? []
}

/**
 * Record a usage snapshot, collapsing rapid updates and pruning old points.
 */
export function recordUsage(usage: ClaudeUsage) {
  if (!store) {
    return
  }
  const now = Date.now()
  const point: UsagePoint = {
    t: now,
    s: usage.five_hour?.utilization ?? 0,
    w: usage.seven_day?.utilization ?? 0,
  }

  const history = getHistory()
  const last = history[history.length - 1]
  if (last && now - last.t < MIN_GAP_MS) {
    history[history.length - 1] = point
  } else {
    history.push(point)
  }

  const pruned = history.filter((p) => now - p.t <= WINDOW_MS)
  void store.update(KEY, pruned)
}

export interface BurnStats {
  /** Number of points in the tracked window. */
  count: number
  /** Span of the tracked history, in hours. */
  spanHours: number
  /** Session utilization change per hour over the recent window (can be <0 after a reset). */
  sessionRatePerHour: number
  /** Weekly utilization change per hour over the tracked window. */
  weeklyRatePerHour: number
  /** Minutes until session reaches 100% at the recent rate, or null if not rising. */
  sessionEtaMinutes: number | null
}

/**
 * Derive burn-rate statistics. Session rate uses the most recent ~1h of data
 * (so a 5h-window reset doesn't skew it); weekly rate uses the full span.
 */
export function computeBurn(history: UsagePoint[], currentSession: number): BurnStats | null {
  if (history.length < 2) {
    return null
  }
  const first = history[0]
  const last = history[history.length - 1]
  const spanMs = last.t - first.t
  const spanHours = spanMs / (60 * 60 * 1000)

  // Recent session rate: find the earliest point within the last hour.
  const recentCutoff = last.t - 60 * 60 * 1000
  const recentStart = history.find((p) => p.t >= recentCutoff) ?? first
  const recentHours = (last.t - recentStart.t) / (60 * 60 * 1000)
  const sessionRatePerHour =
    recentHours > 0 ? (last.s - recentStart.s) / recentHours : 0

  const weeklyRatePerHour =
    spanHours > 0 ? (last.w - first.w) / spanHours : 0

  let sessionEtaMinutes: number | null = null
  if (sessionRatePerHour > 0.1 && currentSession < 100) {
    sessionEtaMinutes = Math.round(((100 - currentSession) / sessionRatePerHour) * 60)
  }

  return {
    count: history.length,
    spanHours,
    sessionRatePerHour,
    weeklyRatePerHour,
    sessionEtaMinutes,
  }
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/**
 * Render a compact sparkline of the session history (0-100% mapped to 8 levels).
 * Down-samples to at most `width` buckets.
 */
export function sessionSparkline(history: UsagePoint[], width = 16): string {
  if (history.length === 0) {
    return ''
  }
  const values = history.map((p) => p.s)
  const buckets: number[] = []
  const step = values.length / width
  if (values.length <= width) {
    buckets.push(...values)
  } else {
    for (let i = 0; i < width; i++) {
      const start = Math.floor(i * step)
      const end = Math.max(start + 1, Math.floor((i + 1) * step))
      const slice = values.slice(start, end)
      buckets.push(slice.reduce((a, b) => a + b, 0) / slice.length)
    }
  }
  return buckets
    .map((v) => {
      const clamped = Math.max(0, Math.min(100, v))
      const idx = Math.min(SPARK.length - 1, Math.floor((clamped / 100) * SPARK.length))
      return SPARK[idx]
    })
    .join('')
}

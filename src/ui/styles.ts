import * as vscode from 'vscode'
import { ClaudeUsage } from '../types'

/**
 * Status bar appearance system.
 *
 * A "style" is a self-contained renderer that turns a usage percentage (and,
 * for some styles, a secondary percentage) into the text shown in the status
 * bar. Styles are grouped into plain ASCII forms and richer Unicode-bar
 * ("graphic") forms. The status bar can only render text + theme icons, so all
 * graphics are built from Unicode glyphs.
 */

export type StyleId =
  | 'percent'
  | 'dual'
  | 'dots'
  | 'brackets'
  | 'minimal'
  | 'blocks'
  | 'braille'
  | 'gradient'
  | 'vmeter'
  | 'vtwin'
  | 'vgauge'
  | 'iconmeter'
  | 'iconsmall'

export type DisplayWindow = 'session' | 'weekly' | 'highest' | 'both'

export interface StyleMeta {
  id: StyleId
  label: string
  group: 'ascii' | 'graphic' | 'vertical' | 'icon'
}

/** Registry of all selectable styles, in display order. */
export const STYLES: StyleMeta[] = [
  { id: 'percent', label: 'Percent', group: 'ascii' },
  { id: 'dual', label: 'Session · Weekly', group: 'ascii' },
  { id: 'dots', label: 'Dot meter', group: 'ascii' },
  { id: 'brackets', label: 'Bracket bar', group: 'ascii' },
  { id: 'minimal', label: 'Minimal', group: 'ascii' },
  { id: 'blocks', label: 'Block bar', group: 'graphic' },
  { id: 'braille', label: 'Braille meter', group: 'graphic' },
  { id: 'gradient', label: 'Gradient bar', group: 'graphic' },
  { id: 'vmeter', label: 'Vertical meter', group: 'vertical' },
  { id: 'vtwin', label: 'Vertical twin', group: 'vertical' },
  { id: 'vgauge', label: 'Vertical gauge', group: 'vertical' },
  { id: 'iconmeter', label: 'Icon meter', group: 'icon' },
  { id: 'iconsmall', label: 'Icon meter (small)', group: 'icon' },
]

/** Lower-block glyphs for vertical fills, from 1/8 to full. */
const VBLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** A single vertical glyph whose height encodes the percentage (8 levels). */
function vGlyph(percent: number): string {
  const level = Math.min(VBLOCKS.length, Math.max(1, Math.ceil((clampPercent(percent) / 100) * VBLOCKS.length)))
  return VBLOCKS[level - 1]
}

/**
 * A smooth horizontal gauge made of vertically-filling cells. Each cell holds
 * 8 sub-levels, so the trailing partial cell gives sub-segment precision.
 */
function vGauge(percent: number, length: number): string {
  const n = Math.max(1, Math.round(length))
  const sub = Math.round((clampPercent(percent) / 100) * n * 8)
  let out = ''
  for (let i = 0; i < n; i++) {
    const cell = Math.min(8, Math.max(0, sub - i * 8))
    out += cell === 0 ? '▁' : VBLOCKS[cell - 1]
  }
  return out
}

export interface RenderConfig {
  style: StyleId
  display: DisplayWindow
  icon: string
  barLength: number
  /** Optional separate style for the weekly bar in "both" mode (bar styles only). */
  styleWeekly?: StyleId
}

interface Resolved {
  primary: number
  secondary: number | null
}

function pct(value: number): string {
  return `${Math.round(value)}%`
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * Resolve which window(s) a style should render, based on the display mode.
 * Bar styles only use `primary`; the dual/percent styles may also use
 * `secondary` when the display mode requests both windows.
 */
function resolve(usage: ClaudeUsage, display: DisplayWindow): Resolved {
  const session = usage.five_hour?.utilization ?? 0
  const weekly = usage.seven_day?.utilization ?? 0

  switch (display) {
    case 'session':
      return { primary: session, secondary: null }
    case 'weekly':
      return { primary: weekly, secondary: null }
    case 'highest':
      return { primary: Math.max(session, weekly), secondary: null }
    default:
      return { primary: session, secondary: weekly }
  }
}

/** Build a two-glyph progress bar of the configured length. */
function bar(percent: number, length: number, filled: string, empty: string): string {
  const n = Math.max(1, Math.round(length))
  const fill = Math.round((clampPercent(percent) / 100) * n)
  return filled.repeat(fill) + empty.repeat(n - fill)
}

function withIcon(icon: string, body: string): string {
  return icon ? `${icon} ${body}` : body
}

/**
 * Render the full status bar text for the given usage and configuration, as a
 * single string (one status bar item). In "both" display mode, bar styles show
 * two bars — one for the session limit and one for the weekly limit.
 */
export function renderStatusText(usage: ClaudeUsage, config: RenderConfig): string {
  const { style, icon, barLength, display } = config
  const session = usage.five_hour?.utilization ?? 0
  const weekly = usage.seven_day?.utilization ?? 0
  const { primary, secondary } = resolve(usage, display)

  switch (style) {
    case 'percent':
      return withIcon(icon, secondary === null ? pct(primary) : `${pct(primary)} · ${pct(secondary)}`)

    case 'dual':
      // Always session · weekly, regardless of display mode.
      return withIcon(icon, `${pct(session)} · ${pct(weekly)}`)

    case 'minimal':
      // Ultra-compact: no icon, just the number(s).
      return secondary === null ? pct(primary) : `${pct(primary)}·${pct(secondary)}`

    case 'vtwin':
      // Two vertical glyphs: session vs weekly, regardless of display mode.
      return withIcon(icon, `${vGlyph(session)}${vGlyph(weekly)} ${pct(session)}·${pct(weekly)}`)

    default: {
      // Bar styles: "<bar> <pct>" per window; two bars in "both" mode, where the
      // weekly bar may use its own style.
      const weeklyStyle = config.styleWeekly ?? style
      const body =
        display === 'both'
          ? `${renderWindow(style, session, barLength)} ${renderWindow(weeklyStyle, weekly, barLength)}`
          : renderWindow(style, primary, barLength)
      return withIcon(icon, body)
    }
  }
}

/** Render a single window ("<bar> <pct>", or just "<pct>" for non-bar styles). */
function renderWindow(style: StyleId, percent: number, length: number): string {
  const glyphs = barGlyphs(style, percent, length)
  return glyphs !== null ? `${glyphs} ${pct(percent)}` : pct(percent)
}

export type UsageLevel = 'normal' | 'warn' | 'crit'

export interface ColorConfig {
  enabled: boolean
  warn: number
  crit: number
  /** Optional custom hex colors; empty string falls back to the theme color. */
  normalColor?: string
  warnColor?: string
  critColor?: string
}

/** The peak percentage that drives coloring for the given display mode. */
export function peakPercent(usage: ClaudeUsage, display: DisplayWindow): number {
  const { primary, secondary } = resolve(usage, display)
  return Math.max(primary, secondary ?? 0)
}

/** Classify a peak percentage into a usage level by the thresholds. */
export function levelForPercent(peak: number, warn: number, crit: number): UsageLevel {
  if (peak >= crit) {
    return 'crit'
  }
  if (peak >= warn) {
    return 'warn'
  }
  return 'normal'
}

/** Build a synthetic usage object at a fixed percentage (for previews). */
export function usageAt(percent: number): ClaudeUsage {
  return {
    five_hour: { utilization: percent, resets_at: null },
    seven_day: { utilization: percent, resets_at: null },
  }
}

/**
 * The bar glyphs for a bar-based style at a percentage, or null for non-bar
 * styles. Codicon styles emit `$(name)` tokens, which render as vector icons in
 * the status bar (and in the settings panel via the codicon font).
 */
function barGlyphs(style: StyleId, percent: number, length: number): string | null {
  switch (style) {
    case 'dots':
      return bar(percent, length, '●', '○')
    case 'brackets':
      return `[${bar(percent, length, '#', '·')}]`
    case 'blocks':
      return bar(percent, length, '▰', '▱')
    case 'braille':
      return bar(percent, length, '⣿', '⣀')
    case 'gradient':
      return bar(percent, length, '▓', '░')
    case 'vmeter':
      return vGlyph(percent)
    case 'vgauge':
      return vGauge(percent, length)
    case 'iconmeter':
      return bar(percent, length, '$(circle-large-filled)', '$(circle-large-outline)')
    case 'iconsmall':
      return bar(percent, length, '$(circle-filled)', '$(circle-outline)')
    default:
      return null
  }
}

/** Whether a style renders a progress bar (vs. plain numbers). */
export function isBarStyle(style: StyleId): boolean {
  return barGlyphs(style, 50, 4) !== null
}

// --- Settings-panel previews ---------------------------------------------

/**
 * Fixed config for the style gallery thumbnails — independent of user options
 * so changing bar length / colors does not disturb the style picker cards.
 */
const GALLERY_USAGE: ClaudeUsage = {
  five_hour: { utilization: 67, resets_at: null },
  seven_day: { utilization: 34, resets_at: null },
}
const GALLERY_CONFIG: Omit<RenderConfig, 'style'> = {
  display: 'both',
  icon: '✼',
  barLength: 8,
}

export interface GalleryItem extends StyleMeta {
  text: string
}

/** Stable, uncolored thumbnails for the style picker. */
export function renderGallery(): GalleryItem[] {
  return STYLES.map((meta) => ({
    ...meta,
    text: renderStatusText(GALLERY_USAGE, { ...GALLERY_CONFIG, style: meta.id }),
  }))
}

/** Level for a given percent under the color config (undefined when disabled). */
export function previewLevel(percent: number, color: ColorConfig): UsageLevel | undefined {
  return color.enabled ? levelForPercent(percent, color.warn, color.crit) : undefined
}

export interface SampleItem {
  percent: number
  text: string
  level?: UsageLevel
}

/**
 * Render the selected style across several fill percentages (single window),
 * with the live options, so the user sees it at e.g. 30/80/40%.
 */
export function renderSamples(
  style: StyleId,
  config: Omit<RenderConfig, 'style' | 'display'>,
  percents: number[],
  color: ColorConfig,
): SampleItem[] {
  return percents.map((percent) => ({
    percent,
    text: renderStatusText(usageAt(percent), { ...config, style, display: 'session' }),
    level: previewLevel(percent, color),
  }))
}

/**
 * Whole-item color, based on the peak percentage for the display mode. Honors
 * custom hex colors, falling back to theme colors.
 */
export function statusColor(
  usage: ClaudeUsage,
  display: DisplayWindow,
  color: ColorConfig,
): string | vscode.ThemeColor | undefined {
  if (!color.enabled) {
    return undefined
  }
  const level = levelForPercent(peakPercent(usage, display), color.warn, color.crit)
  if (level === 'crit') {
    return color.critColor || new vscode.ThemeColor('errorForeground')
  }
  if (level === 'warn') {
    return color.warnColor || new vscode.ThemeColor('editorWarning.foreground')
  }
  return color.normalColor || undefined
}

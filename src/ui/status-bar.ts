import * as vscode from 'vscode'
import { ClaudeUsage, AuthData } from '../types'
import {
  createMainTooltip,
  createAuthRequiredTooltip,
  createAuthErrorTooltip,
  createUpdatingTooltip,
  createFetchErrorTooltip,
  createUpdateErrorTooltip,
  createRateLimitTooltip,
} from './tooltip-builder'
import {
  renderStatusText,
  statusColor,
  ColorConfig,
  RenderConfig,
  StyleId,
  DisplayWindow,
} from './styles'

// A single status bar item — kept single (rather than split into colored
// segments) so other extensions' items never wedge themselves between parts of
// our display. The trade-off: color applies to the whole item, not just the bar.
const COMMAND = 'claude-usage.openMenu'
let statusBarItem: vscode.StatusBarItem

// Last successfully rendered data, kept so the status bar can be re-rendered
// instantly when appearance settings change (without waiting for a refetch).
let lastUsage: ClaudeUsage | undefined
let lastAuthData: AuthData | undefined

/** Read the appearance-related settings into a single config object. */
function readRenderConfig(): RenderConfig {
  const config = vscode.workspace.getConfiguration('claudeUsage')
  const weekly = config.get<string>('statusBarStyleWeekly', 'vmeter')
  return {
    style: config.get<StyleId>('statusBarStyle', 'vgauge'),
    display: config.get<DisplayWindow>('statusBarDisplay', 'both'),
    icon: config.get<string>('statusBarIcon', '✼'),
    barLength: config.get<number>('barLength', 8),
    styleWeekly: weekly === 'same' ? undefined : (weekly as StyleId),
  }
}

/** Read color-related settings. */
function readColorConfig(): ColorConfig {
  const config = vscode.workspace.getConfiguration('claudeUsage')
  return {
    enabled: config.get<boolean>('colorEnabled', true),
    warn: config.get<number>('warnThreshold', 75),
    crit: config.get<number>('critThreshold', 90),
    normalColor: config.get<string>('normalColor', ''),
    warnColor: config.get<string>('warnColor', ''),
    critColor: config.get<string>('critColor', ''),
  }
}

/**
 * Create and initialize the status bar item.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  )

  statusBarItem.text = '✼ $(sync~spin)'
  statusBarItem.tooltip = 'Initializing Claude Stats Monitor...'
  statusBarItem.command = COMMAND
  statusBarItem.show()

  return statusBarItem
}

/** Set a simple state: text + tooltip + optional whole-item color + command. */
function setState(
  text: string,
  tooltip: vscode.MarkdownString | string,
  color?: string | vscode.ThemeColor,
  command: string = COMMAND,
) {
  statusBarItem.text = text
  statusBarItem.color = color
  statusBarItem.backgroundColor = undefined
  statusBarItem.tooltip = tooltip
  statusBarItem.command = command
}

/**
 * Update status bar with usage data.
 */
export function updateStatusBar(usage: ClaudeUsage, authData: AuthData) {
  lastUsage = usage
  lastAuthData = authData

  const renderConfig = readRenderConfig()
  const colorConfig = readColorConfig()

  setState(
    renderStatusText(usage, renderConfig),
    createMainTooltip(usage, authData),
    statusColor(usage, renderConfig.display, colorConfig),
  )
}

/**
 * Re-render the status bar from the last known data using the current settings.
 * Used when appearance settings change so the bar updates immediately.
 */
export function refreshStatusBar(): ClaudeUsage | undefined {
  if (lastUsage && lastAuthData) {
    updateStatusBar(lastUsage, lastAuthData)
  }
  return lastUsage
}

/**
 * Get the last successfully fetched usage, for settings preview seeding.
 */
export function getLastUsage(): ClaudeUsage | undefined {
  return lastUsage
}

/**
 * Show authentication required state
 */
export function showAuthRequired() {
  setState(
    '$(error)',
    createAuthRequiredTooltip(),
    new vscode.ThemeColor('errorForeground'),
  )
}

/**
 * Show authentication error state
 */
export function showAuthError(error: unknown) {
  setState(
    '$(error)',
    createAuthErrorTooltip(error),
    new vscode.ThemeColor('errorForeground'),
  )
}

/**
 * Show updating state
 */
export function showUpdating() {
  setState('✼ $(sync~spin)', createUpdatingTooltip())
}

/**
 * Show rate-limited (429) state.
 */
export function showRateLimited(retryAfterSeconds?: number) {
  setState(
    '$(clock) 429',
    createRateLimitTooltip(retryAfterSeconds),
    new vscode.ThemeColor('editorWarning.foreground'),
  )
}

/**
 * Show fetch error state
 */
export function showFetchError() {
  setState(
    '$(warning)',
    createFetchErrorTooltip(),
    new vscode.ThemeColor('editorWarning.foreground'),
  )
}

/**
 * Show update error state
 */
export function showUpdateError(error: unknown) {
  setState(
    '$(warning)',
    createUpdateErrorTooltip(error),
    new vscode.ThemeColor('editorWarning.foreground'),
  )
}

/**
 * Live-quota not enabled yet: prompt the user to install the statusline tap.
 * Clicking runs the enable command directly.
 */
export function showLiveQuotaSetup() {
  const tip = new vscode.MarkdownString(
    '**Claude Usage Bars**\n\nClick to enable live quota.\n\n' +
      'Reads usage locally from Claude Code\'s statusline — no network call, no token.',
  )
  setState('✼ $(plug) Enable', tip, undefined, 'claude-usage.enableLiveQuota')
}

/**
 * Tap installed but Claude Code hasn't rendered a statusline yet (no cache).
 */
export function showWaitingForSession() {
  const tip = new vscode.MarkdownString(
    '**Claude Usage Bars**\n\nWaiting for data. Open a Claude Code session once — ' +
      'its statusline fills this in — then it updates every turn.',
  )
  setState('✼ $(watch)', tip)
}

/**
 * Get the status bar item.
 */
export function getStatusBarItem(): vscode.StatusBarItem {
  return statusBarItem
}

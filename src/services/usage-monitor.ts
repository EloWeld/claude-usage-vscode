import * as vscode from 'vscode'
import { AuthData, ClaudeUsage } from '../types'
import {
  updateStatusBar,
  showLiveQuotaSetup,
  showWaitingForSession,
} from '../ui/status-bar'
import { recordUsage } from './history'
import { readLocalUsage } from './statusline'
import { isStatuslineInstalled } from './statusline-install'

let currentAuthData: AuthData | undefined

/**
 * Initialize the usage monitor. Auth data is optional and used only for the
 * tooltip's account label — usage itself comes from the local statusline cache,
 * never the network.
 */
export function initializeMonitor(authData?: AuthData) {
  currentAuthData = authData
}

/** Account label for the tooltip; empty when not signed in. */
function authForTooltip(): AuthData {
  return currentAuthData ?? { email: '' }
}

/** First workspace folder, used to resolve the effective statusline scope. */
function workspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

/**
 * Update usage from the local statusline cache (ToS-compliant: no network call,
 * no OAuth token). States:
 *   - tap not installed → prompt to enable live quota
 *   - installed but no render yet → "waiting for a Claude session"
 *   - data present → render it
 */
export async function updateUsage() {
  const ws = workspacePath()

  if (!isStatuslineInstalled(ws)) {
    showLiveQuotaSetup()
    return
  }

  const local = readLocalUsage()
  if (!local || (!local.usage.five_hour && !local.usage.seven_day)) {
    showWaitingForSession()
    return
  }

  recordUsage(local.usage)
  updateStatusBar(local.usage, authForTooltip())

  const config = vscode.workspace.getConfiguration('claudeUsage')
  if (config.get<boolean>('showNotifications')) {
    checkUsageWarnings(local.usage)
  }
}

/**
 * Check usage and show warnings if needed
 */
function checkUsageWarnings(usage: ClaudeUsage) {
  const warnings: string[] = []

  if (usage.five_hour && usage.five_hour.utilization > 90) {
    warnings.push(
      `5-hour limit is ${usage.five_hour.utilization.toFixed(1)}% used`,
    )
  }

  if (usage.seven_day && usage.seven_day.utilization > 90) {
    warnings.push(
      `7-day limit is ${usage.seven_day.utilization.toFixed(1)}% used`,
    )
  }

  if (warnings.length > 0) {
    vscode.window.showWarningMessage(
      `Claude Stats Warning: ${warnings.join(', ')}`,
    )
  }
}

/**
 * Get current auth data
 */
export function getCurrentAuthData(): AuthData | undefined {
  return currentAuthData
}

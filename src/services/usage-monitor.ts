import * as vscode from 'vscode'
import { ClaudeAPIClient, UsageError } from '../claude-client'
import { AuthData, ClaudeUsage } from '../types'
import {
  updateStatusBar,
  showUpdating,
  showFetchError,
  showUpdateError,
  showRateLimited,
} from '../ui/status-bar'
import { recordUsage } from './history'

let apiClient: ClaudeAPIClient | undefined
let currentAuthData: AuthData | undefined
let backoffTimer: NodeJS.Timeout | undefined

const MAX_BACKOFF_SECONDS = 3600

/** Schedule a single retry after a server-suggested delay (429 Retry-After). */
function scheduleBackoff(seconds?: number) {
  if (!seconds || seconds <= 0) {
    return
  }
  if (backoffTimer) {
    clearTimeout(backoffTimer)
  }
  const delay = Math.min(seconds, MAX_BACKOFF_SECONDS) * 1000
  backoffTimer = setTimeout(() => {
    backoffTimer = undefined
    void updateUsage()
  }, delay)
}

/**
 * Initialize the usage monitor with authentication data
 */
export function initializeMonitor(authData: AuthData) {
  currentAuthData = authData
  apiClient = new ClaudeAPIClient(authData)
}

/**
 * Update usage statistics
 */
export async function updateUsage() {
  if (!apiClient || !currentAuthData) {
    console.error('Missing API client or auth data')
    return
  }

  try {
    showUpdating()

    const usage = await apiClient.getUsage()

    if (usage) {
      if (backoffTimer) {
        clearTimeout(backoffTimer)
        backoffTimer = undefined
      }
      recordUsage(usage)
      updateStatusBar(usage, currentAuthData)

      // Check if we should show notifications
      const config = vscode.workspace.getConfiguration('claudeUsage')
      const showNotifications = config.get<boolean>('showNotifications')

      if (showNotifications) {
        checkUsageWarnings(usage)
      }
    } else {
      showFetchError()
    }
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.isRateLimited) {
        showRateLimited(error.info.retryAfterSeconds)
        scheduleBackoff(error.info.retryAfterSeconds)
      } else {
        // Network / server error — keep it quiet with the fetch-error state.
        showFetchError()
      }
    } else {
      console.error('Error updating usage:', error)
      showUpdateError(error)
    }
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

  if (usage.seven_day_opus && usage.seven_day_opus.utilization > 90) {
    warnings.push(
      `7-day Opus limit is ${usage.seven_day_opus.utilization.toFixed(
        1,
      )}% used`,
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

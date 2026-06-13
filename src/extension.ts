import * as vscode from 'vscode'
import { loadAuthData } from './auth/auth-manager'
import {
  createStatusBarItem,
  showAuthRequired,
  showAuthError,
  getStatusBarItem,
  refreshStatusBar,
} from './ui/status-bar'
import { initializeMonitor, updateUsage } from './services/usage-monitor'
import { initHistory } from './services/history'
import { registerCommands } from './commands'

let updateInterval: NodeJS.Timeout | undefined

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Stats Monitor activated')

  // Initialize usage history storage (analytics)
  initHistory(context.globalState)

  // Create status bar item
  const statusBarItem = createStatusBarItem()
  context.subscriptions.push(statusBarItem)

  // Register all commands
  registerCommands(context)

  // React to settings changes: re-render appearance instantly, and restart the
  // polling timer if the interval changed.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('claudeUsage')) {
        return
      }
      refreshStatusBar()
      if (e.affectsConfiguration('claudeUsage.updateInterval')) {
        restartPolling()
      }
    }),
  )

  // Load auth and start monitoring
  loadAuthAndStartMonitoring()
}

function restartPolling() {
  const config = vscode.workspace.getConfiguration('claudeUsage')
  const intervalSeconds = config.get<number>('updateInterval') || 300

  if (updateInterval) {
    clearInterval(updateInterval)
  }
  updateInterval = setInterval(async () => {
    await updateUsage()
  }, intervalSeconds * 1000)
}

async function loadAuthAndStartMonitoring() {
  try {
    const authData = await loadAuthData()

    if (authData) {
      console.log('✅ Auth loaded successfully')

      // Initialize the monitor with auth data
      initializeMonitor(authData)

      // Update immediately
      await updateUsage()

      // Start periodic updates (default 5 minutes)
      restartPolling()
    } else {
      showAuthRequired()
    }
  } catch (error) {
    console.error('Error loading auth:', error)
    showAuthError(error)
  }
}

export function deactivate() {
  if (updateInterval) {
    clearInterval(updateInterval)
  }
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }
}

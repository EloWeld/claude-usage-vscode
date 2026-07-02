import * as vscode from 'vscode'
import { loadAuthData } from './auth/auth-manager'
import {
  createStatusBarItem,
  getStatusBarItem,
  refreshStatusBar,
} from './ui/status-bar'
import { initializeMonitor, updateUsage } from './services/usage-monitor'
import { initHistory } from './services/history'
import { selfHealStatusline } from './services/statusline-install'
import { registerCommands } from './commands'

let updateInterval: NodeJS.Timeout | undefined

/** Absolute path to the bundled statusline tap script. */
export function tapSourcePath(context: vscode.ExtensionContext): string {
  return context.asAbsolutePath('resources/statusline-tap.js')
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Usage Bars activated')

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

  startMonitoring(context)
}

async function startMonitoring(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  // Re-wire the tap if it was previously enabled but a checkout/merge reverted
  // the settings under us. No-op when the tap was never installed.
  selfHealStatusline(tapSourcePath(context), ws)

  // Auth data is optional — used only for the tooltip's account label. Usage
  // comes from the local statusline cache, not the network.
  try {
    const authData = await loadAuthData()
    initializeMonitor(authData ?? undefined)
  } catch {
    initializeMonitor(undefined)
  }

  await updateUsage()
  restartPolling()
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

export function deactivate() {
  if (updateInterval) {
    clearInterval(updateInterval)
  }
  const statusBarItem = getStatusBarItem()
  if (statusBarItem) {
    statusBarItem.dispose()
  }
}

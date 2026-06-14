import * as vscode from 'vscode'
import { updateUsage } from '../services/usage-monitor'
import { SettingsPanel, PanelTab } from '../ui/settings-panel'
import { getLastUsage } from '../ui/status-bar'

interface MenuItem extends vscode.QuickPickItem {
  tab?: PanelTab
  action?: 'refresh'
}

/**
 * Register all extension commands
 */
export function registerCommands(context: vscode.ExtensionContext) {
  // No-op command just to show pointer cursor
  const noopCommand = vscode.commands.registerCommand(
    'claude-usage.noop',
    () => {
      // No-op command just to show pointer cursor
    },
  )

  // Refresh command
  const refreshCommand = vscode.commands.registerCommand(
    'claude-usage.refresh',
    async () => {
      await updateUsage()
    },
  )

  // Login command
  const loginCommand = vscode.commands.registerCommand(
    'claude-usage.login',
    async () => {
      const selection = await vscode.window.showInformationMessage(
        'You need to authenticate with Claude Code to use this extension.',
        'Help',
      )

      if (selection === 'Help') {
        vscode.env.openExternal(
          vscode.Uri.parse('https://docs.claude.com/en/docs/claude-code'),
        )
      }
    },
  )

  // Open the panel on the Settings tab
  const settingsCommand = vscode.commands.registerCommand(
    'claude-usage.openSettings',
    () => {
      SettingsPanel.show(context.extensionUri, 'settings')
    },
  )

  // Open the panel on the Usage tab
  const usageCommand = vscode.commands.registerCommand(
    'claude-usage.openUsage',
    () => {
      SettingsPanel.show(context.extensionUri, 'usage')
    },
  )

  // Click menu: choose where to go (Usage / Settings / Refresh)
  const menuCommand = vscode.commands.registerCommand(
    'claude-usage.openMenu',
    async () => {
      const usage = getLastUsage()
      const summary = usage
        ? `Session ${Math.round(usage.five_hour?.utilization ?? 0)}% · Weekly ${Math.round(usage.seven_day?.utilization ?? 0)}%`
        : 'No usage data yet'

      const items: MenuItem[] = [
        { label: '$(graph) Usage', description: 'Charts & breakdown', tab: 'usage' },
        { label: '$(gear) Settings', description: 'Status bar appearance', tab: 'settings' },
        { label: '$(sync) Refresh now', description: 'Refetch usage', action: 'refresh' },
      ]

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `Claude — ${summary}`,
      })
      if (!pick) {
        return
      }
      if (pick.action === 'refresh') {
        await updateUsage()
        return
      }
      SettingsPanel.show(context.extensionUri, pick.tab ?? 'usage')
    },
  )

  // Register all commands
  context.subscriptions.push(noopCommand)
  context.subscriptions.push(refreshCommand)
  context.subscriptions.push(loginCommand)
  context.subscriptions.push(settingsCommand)
  context.subscriptions.push(usageCommand)
  context.subscriptions.push(menuCommand)
}
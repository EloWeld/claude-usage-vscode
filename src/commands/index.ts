import * as vscode from 'vscode'
import { updateUsage } from '../services/usage-monitor'
import { SettingsPanel } from '../ui/settings-panel'

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

  // Open the appearance settings panel
  const settingsCommand = vscode.commands.registerCommand(
    'claude-usage.openSettings',
    () => {
      SettingsPanel.show(context.extensionUri)
    },
  )

  // Register all commands
  context.subscriptions.push(noopCommand)
  context.subscriptions.push(refreshCommand)
  context.subscriptions.push(loginCommand)
  context.subscriptions.push(settingsCommand)
}
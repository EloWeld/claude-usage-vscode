import { AuthData, ClaudeConfig } from '../types'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Load the account label (email / display name) from `~/.claude.json`.
 *
 * This is purely for the tooltip's account line — it reads only local user info
 * and never touches the OAuth token or the network. Usage data comes from the
 * local statusline cache (see services/statusline.ts).
 */
export async function loadAuthData(): Promise<AuthData | null> {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json')
    if (!fs.existsSync(claudeConfigPath)) {
      return null
    }

    const config: ClaudeConfig = JSON.parse(
      fs.readFileSync(claudeConfigPath, 'utf-8'),
    )
    if (!config.oauthAccount) {
      return null
    }

    return {
      email: config.oauthAccount.emailAddress,
      displayName: config.oauthAccount.displayName,
    }
  } catch (error) {
    console.warn('⚠️ Could not load ~/.claude.json:', error)
    return null
  }
}

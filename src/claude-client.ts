import axios from 'axios'
import { AuthData, ClaudeUsage } from './types'

export interface UsageErrorInfo {
  /** HTTP status code, if the request reached the server. */
  status?: number
  /** Seconds to wait before retrying, parsed from Retry-After (429 responses). */
  retryAfterSeconds?: number
  /** Human-readable message. */
  message: string
}

/** A structured error from the usage API so the UI can react to e.g. 429. */
export class UsageError extends Error {
  readonly info: UsageErrorInfo

  constructor(info: UsageErrorInfo) {
    super(info.message)
    this.name = 'UsageError'
    this.info = info
  }

  get isRateLimited(): boolean {
    return this.info.status === 429
  }
}

/** Parse a Retry-After header (seconds, or an HTTP date) into seconds. */
function parseRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds))
  }
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000))
  }
  return undefined
}

export class ClaudeAPIClient {
  private authData: AuthData
  private baseUrl = 'https://api.anthropic.com'
  private lastUsage: ClaudeUsage | null = null

  constructor(authData: AuthData) {
    this.authData = authData
  }

  async getUsage(): Promise<ClaudeUsage | null> {
    try {
      const url = `${this.baseUrl}/api/oauth/usage`

      const headers = {
        Authorization: `Bearer ${this.authData.accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-beta':
          'oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14',
      }

      const response = await axios.get(url, { headers })

      if (response.status === 200) {
        this.lastUsage = response.data
        console.log('✅ Claude Stats retrieved successfully')
        return this.lastUsage
      }

      console.error('⚠️ Unexpected status:', response.status)
      return this.lastUsage
    } catch (error) {
      throw this.toUsageError(error)
    }
  }

  /** Last successfully fetched usage, if any (stale fallback). */
  getCachedUsage(): ClaudeUsage | null {
    return this.lastUsage
  }

  private toUsageError(error: unknown): UsageError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const retryAfterSeconds = parseRetryAfter(error.response?.headers?.['retry-after'])
      const apiMessage = error.response?.data?.error?.message as string | undefined
      const message =
        status === 429
          ? 'Rate limited by the Claude API (429)'
          : apiMessage || error.message || 'Failed to fetch usage'
      console.error(`❌ Usage fetch failed (status ${status ?? 'n/a'}): ${message}`)
      return new UsageError({ status, retryAfterSeconds, message })
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error('❌ Usage fetch failed:', message)
    return new UsageError({ message })
  }
}

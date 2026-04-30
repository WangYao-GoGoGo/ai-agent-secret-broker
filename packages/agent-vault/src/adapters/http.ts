/**
 * HTTP Adapter Module
 *
 * Makes HTTP requests to external APIs using credentials from the vault.
 * The API key/token is injected as an Authorization header and never
 * exposed to the AI agent.
 *
 * Uses Node.js built-in `fetch` (available since Node 18).
 */

import type { SecretHandle } from '../types/index.js'

// ─── Types ────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface CallApiOptions {
  method: HttpMethod
  path: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

export interface CallApiResult {
  success: boolean
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string
}

// ─── Adapter ──────────────────────────────────────────────────────────────

export class HttpAdapter {
  /**
   * Make an HTTP request to an external API using credentials from the vault.
   *
   * The API key is read from `secretHandle.get('token')` and injected as
   * `Authorization: Bearer <token>` by default. Custom headers can override
   * this behavior via `options.headers`.
   *
   * The base URL is read from `secretHandle.get('host')`.
   */
  async callApi(
    secretHandle: SecretHandle,
    options: CallApiOptions
  ): Promise<CallApiResult> {
    // 1. Build base URL from secret handle
    const baseUrl = String(secretHandle.get('host') ?? '')
    if (!baseUrl) {
      return {
        success: false,
        statusCode: 0,
        statusText: 'Bad Request',
        headers: {},
        body: JSON.stringify({ error: 'No base URL configured for this credential' }),
      }
    }

    // 2. Build URL
    const cleanBase = baseUrl.replace(/\/+$/, '')
    const cleanPath = options.path.replace(/^\/+/, '')
    const url = `${cleanBase}/${cleanPath}`

    // 3. Build headers
    const token = String(secretHandle.get('token') ?? '')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // Only add Authorization if token exists and not already set
    if (token && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // 4. Make HTTP request using fetch()
    const controller = new AbortController()
    const timeoutMs = options.timeout ?? 30_000
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      })

      const body = await response.text()

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      return {
        success: response.ok,
        statusCode: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        statusCode: 0,
        statusText: 'Error',
        headers: {},
        body: JSON.stringify({ error: errorMsg }),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Factory function to create an HTTP adapter.
 */
export function createHttpAdapter(): HttpAdapter {
  return new HttpAdapter()
}

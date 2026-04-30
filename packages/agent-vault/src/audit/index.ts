/**
 * Audit Logger Module
 *
 * Records every requested operation in a secret-safe audit log.
 * Audit logs must never contain raw secrets.
 */

import { appendFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getAuditPath, ensureBaseDir } from '../utils/paths.js'
import type { AuditEntry } from '../types/index.js'

export class AuditLogger {
  private entries: AuditEntry[] = []

  /**
   * Load existing audit entries from disk.
   */
  async load(): Promise<void> {
    ensureBaseDir()
    const auditPath = getAuditPath()

    if (!existsSync(auditPath)) {
      this.entries = []
      return
    }

    try {
      const content = await readFile(auditPath, 'utf-8')
      this.entries = content
        .split('\n')
        .filter((line: string) => line.trim())
        .map((line: string) => JSON.parse(line) as AuditEntry)
    } catch {
      this.entries = []
    }
  }

  /**
   * Append a new audit entry.
   */
  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry)

    // Persist to disk
    try {
      ensureBaseDir()
      const line = JSON.stringify(entry) + '\n'
      await appendFile(getAuditPath(), line, { mode: 0o600 })
    } catch {
      // Silently fail - audit log failure should not crash the app
    }
  }

  /**
   * Query recent audit entries.
   */
  query(limit: number = 50, filter?: Partial<Record<string, unknown>>): AuditEntry[] {
    let results = [...this.entries]

    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (value !== undefined) {
          results = results.filter((e) => (e as unknown as Record<string, unknown>)[key] === value)
        }
      }
    }

    return results.slice(-limit).reverse()
  }

  /**
   * Get all entries (for export).
   */
  getAll(): AuditEntry[] {
    return [...this.entries]
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.length
  }
}

/**
 * Factory function to create an audit logger.
 */
export function createAuditLogger(): AuditLogger {
  return new AuditLogger()
}

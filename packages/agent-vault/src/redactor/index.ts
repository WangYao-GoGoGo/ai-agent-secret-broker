/**
 * Output Redactor Module
 *
 * Removes sensitive values from execution results before they are
 * returned to AI or written to logs.
 */

import type { RedactionRule, SecretHandle } from '../types/index.js'

/**
 * Default redaction rules for common sensitive patterns.
 */
const DEFAULT_RULES: RedactionRule[] = [
  // URL with embedded credentials (must be before email to avoid conflict)
  { name: 'url-credentials', pattern: /:\/\/[^:]+:[^@]+@/g, replacement: '://<USER>:<PASS>@' },
  // Private IPv4 (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  { name: 'private-ip', pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, replacement: '<PRIVATE_IP>' },
  // Public IPv4
  { name: 'public-ip', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: '<IP>' },
  // IPv6
  { name: 'ipv6', pattern: /\b([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g, replacement: '<IPV6>' },
  // Email addresses
  { name: 'email', pattern: /\b[\w.+-]+@[\w.-]+\.\w+\b/g, replacement: '<EMAIL>' },
  // JWT tokens
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '<JWT>' },
  // AWS Access Key
  { name: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: '<AWS_KEY>' },
  // GitHub tokens (ghp_ghs_ghu_gho_ghr)
  { name: 'github-token', pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g, replacement: '<GITHUB_TOKEN>' },
  // SSH private key markers
  { name: 'ssh-key', pattern: /-----BEGIN (OPENSSH|RSA|DSA|EC) PRIVATE KEY-----[\s\S]*?-----END (OPENSSH|RSA|DSA|EC) PRIVATE KEY-----/g, replacement: '<PRIVATE_KEY>' },
  // Database URLs
  { name: 'db-url', pattern: /(postgres|mysql|mongodb|redis):\/\/[^\s'"]+/g, replacement: '<DB_URL>' },
  // Environment variable exports with values
  { name: 'env-export', pattern: /(export\s+\w+=['"]?)[^\s'"]+(['"]?)/g, replacement: '$1<SECRET>$2' },
  // Token patterns (various) — catches "token=abc", "token: abc", and "token abc123"
  { name: 'token', pattern: /(token|secret|key|password|passwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi, replacement: '$1=<REDACTED>' },
  // Generic long alphanumeric strings that look like tokens (sk-, ghp_, etc.)
  { name: 'generic-token', pattern: /\b[0-9a-zA-Z_\-]{20,}\b/g, replacement: '<TOKEN>' },
]

export class OutputRedactor {
  private rules: RedactionRule[]
  private vaultValues: Map<string, string> = new Map()

  constructor(rules?: RedactionRule[]) {
    this.rules = rules ?? DEFAULT_RULES
  }

  /**
   * Register known secret values from the vault for redaction.
   * These are checked first before pattern-based rules.
   */
  registerVaultSecrets(handle: SecretHandle): void {
    const secrets = handle.getAll()
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value === 'string' && value.length > 3) {
        this.vaultValues.set(value, `<${key.toUpperCase()}>`)
      }
    }
  }

  /**
   * Redact sensitive information from text.
   */
  redact(text: string): string {
    let result = text

    // 1. Replace known vault values first (exact match)
    for (const [value, placeholder] of this.vaultValues) {
      // Escape special regex characters in the value
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), placeholder)
    }

    // 2. Apply pattern-based rules
    for (const rule of this.rules) {
      result = result.replace(rule.pattern, rule.replacement)
    }

    return result
  }

  /**
   * Add a custom redaction rule.
   */
  addRule(rule: RedactionRule): void {
    this.rules.push(rule)
  }

  /**
   * Clear all registered vault values.
   */
  clearVaultSecrets(): void {
    this.vaultValues.clear()
  }
}

/**
 * Factory function to create an output redactor.
 */
export function createRedactor(rules?: RedactionRule[]): OutputRedactor {
  return new OutputRedactor(rules)
}

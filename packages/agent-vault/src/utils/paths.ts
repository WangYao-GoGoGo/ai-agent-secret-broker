/**
 * Default paths for Agent Vault configuration and data files.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

const DEFAULT_BASE_DIR = join(homedir(), '.agent-vault')

export function getBaseDir(): string {
  return process.env.AGENT_VAULT_DIR || DEFAULT_BASE_DIR
}

export function ensureBaseDir(): string {
  const dir = getBaseDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return dir
}

export function getVaultPath(): string {
  return join(getBaseDir(), 'vault.enc')
}

export function getPolicyPath(): string {
  return join(getBaseDir(), 'policy.yml')
}

export function getAuditPath(): string {
  return join(getBaseDir(), 'audit.log')
}

export function getConfigPath(): string {
  return join(getBaseDir(), 'config.json')
}

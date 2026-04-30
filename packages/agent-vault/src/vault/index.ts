/**
 * Local Encrypted Vault Module
 *
 * Stores credentials in an encrypted file on disk.
 * Uses TweetNaCl secretbox (XSalsa20-Poly1305) with a PBKDF2-derived key.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { encrypt, decrypt } from '../utils/crypto.js'
import { getVaultPath, ensureBaseDir } from '../utils/paths.js'
import {
  SecretHandle,
} from '../types/index.js'
import type {
  Vault,
  CredentialRecord,
  PublicCredentialMetadata,
} from '../types/index.js'

interface VaultFile {
  version: number
  salt: string
  records: string // encrypted JSON string of CredentialRecord[]
}

interface VaultState {
  unlocked: boolean
  password: string | null
  records: Map<string, CredentialRecord>
}

export class LocalVault implements Vault {
  private state: VaultState = {
    unlocked: false,
    password: null,
    records: new Map(),
  }

  async init(): Promise<void> {
    ensureBaseDir()
    const vaultPath = getVaultPath()
    if (existsSync(vaultPath)) {
      throw new Error('Vault already exists. Use unlock() to open it.')
    }
    // Create empty vault file
    await writeFile(vaultPath, '', { mode: 0o600 })
  }

  async unlock(password: string): Promise<void> {
    const vaultPath = getVaultPath()
    if (!existsSync(vaultPath)) {
      throw new Error('Vault not found. Run init first.')
    }

    const content = await readFile(vaultPath, 'utf-8')
    if (!content.trim()) {
      // Empty vault, first time setup
      this.state.unlocked = true
      this.state.password = password
      this.state.records = new Map()
      return
    }

    try {
      const vaultFile: VaultFile = JSON.parse(content)
      const decrypted = await decrypt(vaultFile.records, password)
      const records: CredentialRecord[] = JSON.parse(decrypted)
      this.state.records = new Map(records.map(r => [r.id, r]))
      this.state.unlocked = true
      this.state.password = password
    } catch {
      throw new Error('Failed to unlock vault: wrong password or corrupted file')
    }
  }

  async lock(): Promise<void> {
    await this.persist()
    this.state.unlocked = false
    this.state.password = null
    this.state.records = new Map()
  }

  isUnlocked(): boolean {
    return this.state.unlocked
  }

  async addCredential(record: CredentialRecord): Promise<void> {
    this.requireUnlocked()
    if (this.state.records.has(record.id)) {
      throw new Error(`Credential with id '${record.id}' already exists`)
    }
    // Check alias uniqueness
    for (const r of this.state.records.values()) {
      if (r.alias === record.alias) {
        throw new Error(`Alias '${record.alias}' already exists`)
      }
    }
    this.state.records.set(record.id, record)
    await this.persist()
  }

  async updateCredential(id: string, update: Partial<CredentialRecord>): Promise<void> {
    this.requireUnlocked()
    const existing = this.state.records.get(id)
    if (!existing) {
      throw new Error(`Credential with id '${id}' not found`)
    }
    this.state.records.set(id, { ...existing, ...update, updatedAt: new Date().toISOString() })
    await this.persist()
  }

  async removeCredential(id: string): Promise<void> {
    this.requireUnlocked()
    if (!this.state.records.delete(id)) {
      throw new Error(`Credential with id '${id}' not found`)
    }
    await this.persist()
  }

  async getSecretHandle(alias: string): Promise<SecretHandle> {
    this.requireUnlocked()
    const record = this.findByAlias(alias)
    if (!record) {
      throw new Error(`No credential found for alias '${alias}'`)
    }
    return new SecretHandle(record.alias, record.secretFields)
  }

  async listAliases(): Promise<PublicCredentialMetadata[]> {
    this.requireUnlocked()
    return Array.from(this.state.records.values()).map(r => ({
      alias: r.alias,
      environment: r.metadata.environment,
      type: r.type,
      description: r.metadata.description,
    }))
  }

  async getCredentialById(id: string): Promise<CredentialRecord | null> {
    this.requireUnlocked()
    return this.state.records.get(id) ?? null
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private requireUnlocked(): void {
    if (!this.state.unlocked) {
      throw new Error('Vault is locked. Call unlock() first.')
    }
  }

  private findByAlias(alias: string): CredentialRecord | undefined {
    for (const record of this.state.records.values()) {
      if (record.alias === alias) return record
    }
    return undefined
  }

  private async persist(): Promise<void> {
    if (!this.state.password) return

    const records = Array.from(this.state.records.values())
    const plaintext = JSON.stringify(records)
    const encrypted = await encrypt(plaintext, this.state.password)

    const vaultFile: VaultFile = {
      version: 1,
      salt: '', // salt is embedded in encrypted output
      records: encrypted,
    }

    await writeFile(getVaultPath(), JSON.stringify(vaultFile, null, 2), { mode: 0o600 })
  }
}

/**
 * Factory function to create a new vault instance.
 */
export function createVault(): Vault {
  return new LocalVault()
}

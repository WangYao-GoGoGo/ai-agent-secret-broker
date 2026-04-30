/**
 * Vault Module Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalVault } from '../src/vault/index.js'
import { SecretHandle } from '../src/types/index.js'
import type { CredentialRecord } from '../src/types/index.js'

const TEST_PASSWORD = 'test-master-password-123!'

describe('LocalVault', () => {
  let tempDir: string
  let vault: LocalVault

  beforeAll(async () => {
    // Create temp directory for test vault
    tempDir = mkdtempSync(join(tmpdir(), 'agent-vault-test-'))
    process.env.AGENT_VAULT_DIR = tempDir

    vault = new LocalVault()
    await vault.init()
    await vault.unlock(TEST_PASSWORD)
  })

  afterAll(() => {
    // Cleanup
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
    delete process.env.AGENT_VAULT_DIR
  })

  it('should initialize and unlock', async () => {
    expect(vault.isUnlocked()).toBe(true)
  })

  it('should add a credential', async () => {
    const record: CredentialRecord = {
      id: 'test-1',
      type: 'ssh_server',
      alias: 'test-server',
      metadata: {
        environment: 'test',
        description: 'Test server',
      },
      secretFields: {
        host: '192.168.1.100',
        user: 'root',
        port: 22,
        password: 'secret-password',
        deployPath: '/var/www/test',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await vault.addCredential(record)
    const aliases = await vault.listAliases()
    expect(aliases).toHaveLength(1)
    expect(aliases[0].alias).toBe('test-server')
    expect(aliases[0].environment).toBe('test')
  })

  it('should reject duplicate alias', async () => {
    const record: CredentialRecord = {
      id: 'test-2',
      type: 'ssh_server',
      alias: 'test-server', // Same alias
      metadata: { environment: 'test' },
      secretFields: { host: '10.0.0.1', user: 'admin' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await expect(vault.addCredential(record)).rejects.toThrow('already exists')
  })

  it('should get a SecretHandle for an alias', async () => {
    const handle = await vault.getSecretHandle('test-server')
    expect(handle.alias).toBe('test-server')
    expect(handle.get('host')).toBe('192.168.1.100')
    expect(handle.get('password')).toBe('secret-password')
  })

  it('should prevent SecretHandle serialization', () => {
    const handle = new SecretHandle('test', { key: 'value' })
    expect(() => JSON.stringify(handle)).toThrow('cannot be serialized')
  })

  it('should list aliases without exposing secrets', async () => {
    const aliases = await vault.listAliases()
    expect(aliases[0]).not.toHaveProperty('secretFields')
    expect(aliases[0]).not.toHaveProperty('host')
    expect(aliases[0]).not.toHaveProperty('password')
  })

  it('should update a credential', async () => {
    await vault.updateCredential('test-1', {
      metadata: { environment: 'staging', description: 'Updated' },
    })
    const aliases = await vault.listAliases()
    expect(aliases[0].description).toBe('Updated')
  })

  it('should remove a credential', async () => {
    await vault.removeCredential('test-1')
    const aliases = await vault.listAliases()
    expect(aliases).toHaveLength(0)
  })

  it('should lock and require unlock', async () => {
    await vault.lock()
    expect(vault.isUnlocked()).toBe(false)
    await expect(vault.listAliases()).rejects.toThrow('locked')
    // Re-unlock for cleanup
    await vault.unlock(TEST_PASSWORD)
  })
})

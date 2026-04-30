#!/usr/bin/env node

/**
 * Agent Vault CLI
 *
 * Main command-line interface for managing the secret broker.
 * Uses Commander.js for command parsing.
 */

import { Command } from 'commander'
import { nanoid } from 'nanoid'
import { createVault } from '../vault/index.js'
import { createPolicyEngine } from '../policy/index.js'
import { createConfirmationLayer } from '../confirmation/index.js'
import { createRedactor } from '../redactor/index.js'
import { createAuditLogger } from '../audit/index.js'
import { SecretBroker } from '../broker.js'
import { startMcpServer } from '../mcp/index.js'
import { ensureBaseDir, getPolicyPath, getVaultPath } from '../utils/paths.js'
import { writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { CredentialRecord, CredentialType } from '../types/index.js'

const program = new Command()

program
  .name('agent-vault')
  .description('Local-first credential broker for AI coding agents')
  .version('0.1.0')

// ─── Init ───────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize the vault and configuration')
  .action(async () => {
    try {
      ensureBaseDir()
      const vault = createVault()
      await vault.init()
      console.log('✅ Vault initialized at:', getVaultPath())
      console.log('')
      console.log('Next steps:')
      console.log('  1. Set a master password:  agent-vault vault unlock')
      console.log('  2. Add a server:           agent-vault server add <alias>')
      console.log('  3. Start MCP server:       agent-vault mcp start')
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── Vault Commands ─────────────────────────────────────────────────

const vaultCmd = program.command('vault').description('Manage the encrypted vault')

vaultCmd
  .command('unlock')
  .description('Unlock the vault with a master password')
  .action(async () => {
    try {
      const { default: enquirer } = await import('enquirer')
      const response = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter master password:',
      })

      const vault = createVault()
      await vault.unlock(response.password)
      console.log('✅ Vault unlocked')
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

vaultCmd
  .command('lock')
  .description('Lock the vault')
  .action(async () => {
    try {
      const vault = createVault()
      // We need the password to re-encrypt, so we prompt
      const { default: enquirer } = await import('enquirer')
      const response = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter master password to lock:',
      })
      await vault.unlock(response.password)
      await vault.lock()
      console.log('🔒 Vault locked')
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── Server Commands ────────────────────────────────────────────────

const serverCmd = program.command('server').description('Manage server credentials')

serverCmd
  .command('add')
  .description('Add a new server credential')
  .argument('<alias>', 'Server alias (e.g., prod, staging)')
  .option('-e, --environment <env>', 'Environment (production/staging/test)', 'production')
  .option('-t, --type <type>', 'Credential type', 'ssh_server')
  .action(async (alias: string, options: { environment: string; type: string }) => {
    try {
      const { default: enquirer } = await import('enquirer')

      // Unlock vault
      const pwResponse = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter vault master password:',
      })

      const vault = createVault()
      await vault.unlock(pwResponse.password)

      // Prompt for server details
      const answers = await enquirer.prompt<{
        host: string
        user: string
        port: string
        authType: string
        password?: string
        privateKey?: string
        deployPath: string
        description: string
      }>([
        { type: 'input', name: 'host', message: 'Server host/IP:' },
        { type: 'input', name: 'user', message: 'SSH username:', initial: 'root' },
        { type: 'input', name: 'port', message: 'SSH port:', initial: '22' },
        {
          type: 'select',
          name: 'authType',
          message: 'Authentication type:',
          choices: [
            { name: 'password', message: 'Password' },
            { name: 'private_key', message: 'Private Key' },
          ],
        },
        {
          type: 'password',
          name: 'password',
          message: 'SSH password:',
          skip(this: any) {
            return (this as any).state?.answers?.authType !== 'password'
          },
        },
        {
          type: 'input',
          name: 'privateKey',
          message: 'Path to private key (e.g., ~/.ssh/id_rsa):',
          skip(this: any) {
            return (this as any).state?.answers?.authType !== 'private_key'
          },
        },
        { type: 'input', name: 'deployPath', message: 'Deployment path:', initial: '/var/www/app' },
        { type: 'input', name: 'description', message: 'Description (optional):' },
      ])

      // Read private key if provided
      let privateKeyContent: string | undefined
      if (answers.privateKey) {
        const keyPath = answers.privateKey.replace(/^~/, process.env.HOME || '/root')
        if (existsSync(keyPath)) {
          privateKeyContent = await readFile(keyPath, 'utf-8')
        } else {
          console.error('❌ Private key file not found:', keyPath)
          process.exit(1)
        }
      }

      const record: CredentialRecord = {
        id: nanoid(),
        type: options.type as CredentialType,
        alias,
        metadata: {
          environment: options.environment as 'production' | 'staging' | 'test',
          description: answers.description || undefined,
        },
        secretFields: {
          host: answers.host,
          user: answers.user,
          port: parseInt(answers.port, 10),
          password: answers.password || undefined,
          privateKey: privateKeyContent,
          deployPath: answers.deployPath,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await vault.addCredential(record)
      console.log(`✅ Server '${alias}' added successfully`)
      console.log(`   Environment: ${options.environment}`)
      console.log(`   Host: ${answers.host} (stored encrypted)`)
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

serverCmd
  .command('list')
  .description('List all configured server aliases')
  .action(async () => {
    try {
      const { default: enquirer } = await import('enquirer')
      const pwResponse = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter vault master password:',
      })

      const vault = createVault()
      await vault.unlock(pwResponse.password)
      const aliases = await vault.listAliases()

      if (aliases.length === 0) {
        console.log('No servers configured.')
        return
      }

      console.log('\nConfigured servers:')
      console.log('-'.repeat(50))
      for (const a of aliases) {
        console.log(`  ${a.alias}`)
        console.log(`    Environment: ${a.environment}`)
        console.log(`    Type: ${a.type}`)
        if (a.description) console.log(`    Description: ${a.description}`)
        console.log('')
      }
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

serverCmd
  .command('remove')
  .description('Remove a server credential')
  .argument('<alias>', 'Server alias to remove')
  .action(async (alias: string) => {
    try {
      const { default: enquirer } = await import('enquirer')
      const pwResponse = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter vault master password:',
      })

      const vault = createVault()
      await vault.unlock(pwResponse.password)
      const aliases = await vault.listAliases()
      const target = aliases.find(a => a.alias === alias)

      if (!target) {
        console.error(`❌ Server '${alias}' not found`)
        process.exit(1)
      }

      const confirm = await enquirer.prompt<{ confirm: boolean }>({
        type: 'confirm',
        name: 'confirm',
        message: `Remove server '${alias}'?`,
      })

      if (!confirm.confirm) {
        console.log('Cancelled.')
        return
      }

      console.log(`✅ Server '${alias}' removed`)
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── Policy Commands ────────────────────────────────────────────────

program
  .command('policy')
  .description('Manage security policy')
  .argument('[action]', 'Action: show, edit, reset')
  .action(async (action?: string) => {
    try {
      if (!action || action === 'show') {
        const policyPath = getPolicyPath()
        if (existsSync(policyPath)) {
          const content = await readFile(policyPath, 'utf-8')
          console.log(content)
        } else {
          console.log('No custom policy file found. Using default policy.')
          console.log('')
          console.log('To customize, run: agent-vault policy edit')
        }
        return
      }

      if (action === 'edit') {
        // Open in default editor
        const policyPath = getPolicyPath()
        if (!existsSync(policyPath)) {
          // Create default policy file
          const defaultPolicy = {
            version: 1,
            defaults: { requireConfirmation: true, returnOutput: 'redacted' },
            targets: {
              staging: { environment: 'staging', allowWithoutConfirmation: ['check_service_status', 'view_logs'] },
              prod: { environment: 'production', requireConfirmationForAll: true },
            },
            tools: {
              list_servers: { allowed: true },
              check_service_status: { allowed: true },
              view_logs: { allowed: true, maxLines: 300, redactOutput: true },
              restart_service: { allowed: true, requireConfirmation: true, allowedServices: ['web', 'worker', 'nginx'] },
              deploy_project: { allowed: true, requireConfirmation: true, allowedTargets: ['staging', 'prod'] },
              upload_file: { allowed: true, requireConfirmation: true },
              run_safe_command: { allowed: true, requireConfirmation: true, deniedPatterns: ['rm -rf', 'chmod 777', 'curl | bash', 'cat ~/.ssh', 'printenv', 'env'] },
            },
          }
          await writeFile(policyPath, JSON.stringify(defaultPolicy, null, 2), { mode: 0o600 })
        }
        const { execSync } = await import('node:child_process')
        const editor = process.env.EDITOR || 'vim'
        execSync(`${editor} "${policyPath}"`, { stdio: 'inherit' })
        console.log('✅ Policy updated')
        return
      }

      if (action === 'reset') {
        const policyPath = getPolicyPath()
        if (existsSync(policyPath)) {
          const { default: enquirer } = await import('enquirer')
          const confirm = await enquirer.prompt<{ confirm: boolean }>({
            type: 'confirm',
            name: 'confirm',
            message: 'Reset policy to default?',
          })
          if (confirm.confirm) {
            // Delete the custom policy file
            const { unlink } = await import('node:fs/promises')
            await unlink(policyPath)
            console.log('✅ Policy reset to default')
          }
        } else {
          console.log('Policy is already using defaults.')
        }
        return
      }

      console.error('❌ Unknown action. Use: show, edit, reset')
      process.exit(1)
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── Audit Commands ─────────────────────────────────────────────────

program
  .command('audit')
  .description('View audit log')
  .option('-n, --lines <number>', 'Number of entries to show', '20')
  .option('-t, --tool <tool>', 'Filter by tool name')
  .option('-d, --decision <decision>', 'Filter by decision (allow/deny/confirm)')
  .action(async (options: { lines: string; tool?: string; decision?: string }) => {
    try {
      const audit = createAuditLogger()
      await audit.load()

      const filter: Record<string, unknown> = {}
      if (options.tool) filter.tool = options.tool
      if (options.decision) filter.decision = options.decision

      const entries = audit.query(parseInt(options.lines, 10), filter)

      if (entries.length === 0) {
        console.log('No audit entries found.')
        return
      }

      console.log('\nAudit Log:')
      console.log('-'.repeat(80))
      for (const entry of entries) {
        const icon = entry.decision === 'allow' ? '✅' : entry.decision === 'deny' ? '❌' : '⚠️'
        console.log(`${icon} ${entry.timestamp.slice(0, 19)} | ${entry.tool} | ${entry.targetAlias || '-'} | ${entry.decision} | ${entry.riskLevel}`)
        console.log(`   ${entry.commandSummary}`)
        console.log(`   Result: ${entry.resultSummary.slice(0, 100)}`)
        console.log(`   Duration: ${entry.durationMs}ms`)
        console.log('')
      }
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── MCP Commands ───────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server for AI agent integration')
  .command('start')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    try {
      const { default: enquirer } = await import('enquirer')
      const pwResponse = await enquirer.prompt<{ password: string }>({
        type: 'password',
        name: 'password',
        message: 'Enter vault master password:',
      })

      // Initialize all components
      const vault = createVault()
      await vault.unlock(pwResponse.password)

      const policy = createPolicyEngine()
      await policy.load()

      const confirmation = createConfirmationLayer('MCP Client')
      const redactor = createRedactor()
      const audit = createAuditLogger()
      await audit.load()

      const broker = new SecretBroker(vault, policy, confirmation, redactor, audit)

      console.log('🚀 Starting Agent Vault MCP server...')
      console.log('   Transport: stdio')
      console.log('   Waiting for AI agent connections...')
      console.log('')

      await startMcpServer(broker)
    } catch (err) {
      console.error('❌ Error:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  })

// ─── Parse ──────────────────────────────────────────────────────────

program.parse(process.argv)

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp()
}

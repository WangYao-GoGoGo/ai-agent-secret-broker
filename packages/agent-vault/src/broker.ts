/**
 * Secret Broker - Core Orchestrator
 *
 * Ties together vault, policy engine, confirmation layer,
 * execution adapters, output redactor, and audit logger.
 *
 * This is the main entry point for processing AI tool requests.
 */

import type { Vault } from './types/index.js'
import type {
  ToolCallRequest,
  PolicyDecision,
  RawExecutionResult,
  ConfirmationRequest,
  AuditEntry,
  SecretHandle,
} from './types/index.js'
import type { PolicyEngine } from './policy/index.js'
import type { ConfirmationLayer } from './confirmation/index.js'
import type { OutputRedactor } from './redactor/index.js'
import type { AuditLogger } from './audit/index.js'
import { SshAdapter } from './adapters/ssh.js'
import { HttpAdapter } from './adapters/http.js'
import type { CallApiOptions } from './adapters/http.js'

export class SecretBroker {
  private vault: Vault
  private policy: PolicyEngine
  private confirmation: ConfirmationLayer
  private redactor: OutputRedactor
  private audit: AuditLogger
  private sshAdapter: SshAdapter
  private httpAdapter: HttpAdapter

  constructor(
    vault: Vault,
    policy: PolicyEngine,
    confirmation: ConfirmationLayer,
    redactor: OutputRedactor,
    audit: AuditLogger
  ) {
    this.vault = vault
    this.policy = policy
    this.confirmation = confirmation
    this.redactor = redactor
    this.audit = audit
    this.sshAdapter = new SshAdapter()
    this.httpAdapter = new HttpAdapter()
  }

  /**
   * Process a tool call request from an AI agent.
   * This is the main orchestration method.
   */
  async processRequest(request: ToolCallRequest): Promise<{
    success: boolean
    result: string
    decision: string
  }> {
    const startTime = Date.now()

    // Step 1: Policy evaluation
    const policyDecision = await this.policy.evaluate(
      request.tool,
      request.target,
      request.args
    )

    if (policyDecision.decision === 'deny') {
      await this.recordAudit(request, policyDecision, 'Denied by policy', startTime)
      return {
        success: false,
        result: `❌ Denied: ${policyDecision.reason}`,
        decision: 'deny',
      }
    }

    // Step 2: Confirmation (if required)
    if (policyDecision.decision === 'confirm') {
      const confirmed = await this.requestConfirmation(request, policyDecision)
      if (!confirmed) {
        await this.recordAudit(request, policyDecision, 'Denied by user', startTime)
        return {
          success: false,
          result: '❌ Operation denied by user',
          decision: 'deny',
        }
      }
    }

    // Step 3: Execute (if target is specified)
    if (request.target) {
      try {
        const secretHandle = await this.vault.getSecretHandle(request.target)
        this.redactor.registerVaultSecrets(secretHandle)

        const rawResult = await this.executeOperation(request, secretHandle)

        // Step 4: Redact output
        const redactedStdout = this.redactor.redact(rawResult.stdout)
        const redactedStderr = this.redactor.redact(rawResult.stderr)

        const resultSummary = rawResult.success
          ? `Operation completed (exit code: ${rawResult.exitCode})`
          : `Operation failed (exit code: ${rawResult.exitCode})`

        await this.recordAudit(request, policyDecision, resultSummary, startTime)

        return {
          success: rawResult.success,
          result: redactedStdout || redactedStderr || resultSummary,
          decision: 'allow',
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        await this.recordAudit(request, policyDecision, `Error: ${errorMsg}`, startTime)
        return {
          success: false,
          result: `❌ Error: ${errorMsg}`,
          decision: 'error',
        }
      }
    }

    // No target needed (e.g., list_servers)
    const result = await this.handleNoTargetOperation(request)
    await this.recordAudit(request, policyDecision, result, startTime)
    return {
      success: true,
      result,
      decision: 'allow',
    }
  }

  /**
   * Request user confirmation for a sensitive operation.
   */
  private async requestConfirmation(
    request: ToolCallRequest,
    policyDecision: PolicyDecision
  ): Promise<boolean> {
    const targetPolicy = this.policy.getConfig()?.targets?.[request.target ?? '']
    const env = targetPolicy?.environment ?? 'unknown'

    const confirmRequest: ConfirmationRequest = {
      clientName: 'AI Agent',
      tool: request.tool,
      target: request.target ?? 'unknown',
      environment: env,
      riskLevel: policyDecision.riskLevel,
      summary: this.formatOperationSummary(request),
      policyReason: policyDecision.reason,
    }

    const response = await this.confirmation.requestConfirmation(confirmRequest)
    return response === 'allow_once'
  }

  /**
   * Execute an operation using the appropriate adapter.
   */
  private async executeOperation(
    request: ToolCallRequest,
    secretHandle: SecretHandle
  ): Promise<RawExecutionResult> {
    switch (request.tool) {
      case 'view_logs': {
        const service = String(request.args.service ?? '')
        const lines = Number(request.args.lines ?? 100)
        const command = service
          ? `journalctl -u ${service} -n ${lines} --no-pager`
          : `tail -n ${lines} /var/log/syslog 2>/dev/null || tail -n ${lines} /var/log/messages 2>/dev/null || echo "No log file found"`
        return this.sshAdapter.executeCommand(secretHandle, { command })
      }

      case 'check_service_status': {
        const service = String(request.args.service ?? '')
        const command = service
          ? `systemctl status ${service} 2>&1 || service ${service} status 2>&1 || echo "Service status check failed"`
          : 'echo "No service specified"'
        return this.sshAdapter.executeCommand(secretHandle, { command })
      }

      case 'restart_service': {
        const service = String(request.args.service ?? '')
        const command = `sudo systemctl restart ${service} 2>&1 || sudo service ${service} restart 2>&1 || echo "Restart failed"`
        return this.sshAdapter.executeCommand(secretHandle, { command })
      }

      case 'deploy_project': {
        const deployPath = String(secretHandle.get('deployPath') ?? '/var/www/app')
        const strategy = String(request.args.strategy ?? 'docker_compose')
        let command: string

        if (strategy === 'docker_compose') {
          command = `cd ${deployPath} && git pull && docker compose build && docker compose up -d`
        } else if (strategy === 'npm') {
          command = `cd ${deployPath} && git pull && npm install && npm run build && pm2 restart all`
        } else {
          command = `cd ${deployPath} && git pull`
        }

        return this.sshAdapter.executeCommand(secretHandle, { command, timeout: 120_000 })
      }

      case 'upload_file': {
        const localPath = String(request.args.localPath ?? '')
        const deployPath = String(secretHandle.get('deployPath') ?? '/var/www/app')
        return this.sshAdapter.uploadFile(secretHandle, {
          localPath,
          remotePath: deployPath,
        })
      }

      case 'run_safe_command': {
        const command = String(request.args.command ?? '')
        return this.sshAdapter.executeCommand(secretHandle, { command })
      }

      case 'call_api': {
        const method = String(request.args.method ?? 'GET') as CallApiOptions['method']
        const path = String(request.args.path ?? '/')
        const body = request.args.body !== undefined
          ? (typeof request.args.body === 'string' ? request.args.body : JSON.stringify(request.args.body))
          : undefined
        const headers = request.args.headers as Record<string, string> | undefined
        const timeout = request.args.timeout !== undefined ? Number(request.args.timeout) : undefined

        const httpResult = await this.httpAdapter.callApi(secretHandle, {
          method,
          path,
          headers,
          body,
          timeout,
        })

        // Map CallApiResult to RawExecutionResult
        return {
          success: httpResult.success,
          stdout: JSON.stringify({
            statusCode: httpResult.statusCode,
            statusText: httpResult.statusText,
            body: httpResult.body,
          }, null, 2),
          stderr: '',
          exitCode: httpResult.success ? 0 : 1,
        }
      }

      default:
        throw new Error(`Unknown tool: ${request.tool}`)
    }
  }

  /**
   * Handle operations that don't need a target server.
   */
  private async handleNoTargetOperation(request: ToolCallRequest): Promise<string> {
    if (request.tool === 'list_servers') {
      const aliases = await this.vault.listAliases()
      if (aliases.length === 0) {
        return 'No servers configured. Use `agent-vault server add <alias>` to add one.'
      }
      return aliases
        .map(a => `  • ${a.alias} (${a.environment}) - ${a.type}`)
        .join('\n')
    }
    return `Operation '${request.tool}' completed`
  }

  /**
   * Format a human-readable summary of the operation.
   */
  private formatOperationSummary(request: ToolCallRequest): string {
    const parts: string[] = [`Execute ${request.tool}`]
    if (request.target) parts.push(`on ${request.target}`)
    if (request.args.service) parts.push(`service: ${request.args.service}`)
    if (request.args.command) {
      const cmd = String(request.args.command)
      parts.push(`command: ${cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd}`)
    }
    return parts.join(' ')
  }

  /**
   * Record an audit entry.
   */
  private async recordAudit(
    request: ToolCallRequest,
    decision: PolicyDecision,
    resultSummary: string,
    startTime: number
  ): Promise<void> {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      clientName: 'MCP Client',
      tool: request.tool,
      targetAlias: request.target ?? '',
      riskLevel: decision.riskLevel,
      decision: decision.decision,
      commandSummary: this.formatOperationSummary(request),
      resultSummary,
      durationMs: Date.now() - startTime,
      policyVersion: 1,
    }
    await this.audit.log(entry)
  }
}

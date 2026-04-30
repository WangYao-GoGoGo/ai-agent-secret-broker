/**
 * Core type definitions for Agent Vault
 */

// ─── Credential Types ───────────────────────────────────────────────

export type CredentialType =
  | 'ssh_server'
  | 'github_token'
  | 'docker_registry'
  | 'database'
  | 'cloud_key'
  | 'generic_secret'

export interface SecretFields {
  host?: string
  user?: string
  password?: string
  privateKey?: string
  port?: number
  deployPath?: string
  token?: string
  dbUrl?: string
  cloudKey?: string
  cloudSecret?: string
  [key: string]: unknown
}

export interface CredentialRecord {
  id: string
  type: CredentialType
  alias: string
  metadata: {
    environment: 'production' | 'staging' | 'test' | 'development'
    description?: string
    tags?: string[]
  }
  secretFields: SecretFields
  createdAt: string
  updatedAt: string
}

/** Public metadata exposed to AI (no secrets) */
export interface PublicCredentialMetadata {
  alias: string
  environment: string
  type: CredentialType
  description?: string
}

/** Internal handle passed to execution adapters (not serializable) */
export class SecretHandle {
  public readonly alias: string
  private readonly secrets: SecretFields

  constructor(alias: string, secrets: SecretFields) {
    this.alias = alias
    this.secrets = { ...secrets }
  }

  /** Get a secret value for internal use only */
  get(key: string): unknown {
    return this.secrets[key]
  }

  /** Get all secrets (only for adapter internal use) */
  getAll(): Readonly<SecretFields> {
    return Object.freeze({ ...this.secrets })
  }

  /** Prevent accidental serialization */
  toJSON(): never {
    throw new Error('SecretHandle cannot be serialized')
  }
}

// ─── Vault Types ────────────────────────────────────────────────────

export interface VaultConfig {
  vaultPath: string
  masterPassword?: string
  useKeychain: boolean
}

export interface Vault {
  init(): Promise<void>
  unlock(password: string): Promise<void>
  lock(): Promise<void>
  isUnlocked(): boolean
  addCredential(record: CredentialRecord): Promise<void>
  updateCredential(id: string, record: Partial<CredentialRecord>): Promise<void>
  removeCredential(id: string): Promise<void>
  getSecretHandle(alias: string): Promise<SecretHandle>
  listAliases(): Promise<PublicCredentialMetadata[]>
  getCredentialById(id: string): Promise<CredentialRecord | null>
}

// ─── Policy Types ───────────────────────────────────────────────────

export type Decision = 'allow' | 'deny' | 'confirm'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PolicyDecision {
  decision: Decision
  reason: string
  riskLevel: RiskLevel
}

export interface PolicyConfig {
  version: number
  defaults?: {
    requireConfirmation?: boolean
    returnOutput?: 'redacted' | 'full'
  }
  targets?: Record<string, TargetPolicy>
  tools?: Record<string, ToolPolicy>
  mode?: 'normal' | 'read_only'
}

export interface TargetPolicy {
  environment: string
  allowWithoutConfirmation?: string[]
  requireConfirmationForAll?: boolean
  allowedTools?: string[]
  deniedTools?: string[]
}

export interface ToolPolicy {
  allowed: boolean
  requireConfirmation?: boolean
  maxLines?: number
  redactOutput?: boolean
  allowedServices?: string[]
  allowedTargets?: string[]
  deniedPatterns?: string[]
}

// ─── Execution Types ────────────────────────────────────────────────

export type ToolName =
  | 'list_servers'
  | 'check_service_status'
  | 'view_logs'
  | 'restart_service'
  | 'deploy_project'
  | 'upload_file'
  | 'run_safe_command'
  | 'call_api'

export interface ToolCallRequest {
  tool: ToolName
  target?: string
  args: Record<string, unknown>
}

export interface ApprovedExecutionRequest {
  tool: ToolName
  target: string
  args: Record<string, unknown>
  riskLevel: RiskLevel
}

export interface RawExecutionResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

// ─── Confirmation Types ─────────────────────────────────────────────

export interface ConfirmationRequest {
  clientName: string
  tool: ToolName
  target: string
  environment: string
  riskLevel: RiskLevel
  summary: string
  policyReason: string
}

export type ConfirmationResponse = 'allow_once' | 'deny'

// ─── Redactor Types ─────────────────────────────────────────────────

export interface RedactionRule {
  name: string
  pattern: RegExp
  replacement: string
}

// ─── Audit Types ────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string
  clientName: string
  tool: ToolName
  targetAlias: string
  riskLevel: RiskLevel
  decision: Decision
  commandSummary: string
  resultSummary: string
  durationMs: number
  policyVersion: number
}

// ─── MCP Types ──────────────────────────────────────────────────────

export interface McpServerConfig {
  transport: 'stdio' | 'http'
  port?: number
  clientName?: string
}

// ─── Config Types ───────────────────────────────────────────────────

export interface AppConfig {
  vaultPath: string
  policyPath: string
  auditPath: string
  useKeychain: boolean
  mcp: McpServerConfig
}

/**
 * Agent Vault - Local-first credential broker for AI coding agents
 *
 * Entry point for programmatic usage.
 */

export { createVault, LocalVault } from './vault/index.js'
export { createPolicyEngine, PolicyEngine } from './policy/index.js'
export { createConfirmationLayer, ConfirmationLayer } from './confirmation/index.js'
export { createRedactor, OutputRedactor } from './redactor/index.js'
export { createAuditLogger, AuditLogger } from './audit/index.js'
export { createSshAdapter, SshAdapter } from './adapters/ssh.js'
export { createHttpAdapter, HttpAdapter } from './adapters/http.js'
export { SecretBroker } from './broker.js'
export { McpServer, startMcpServer } from './mcp/index.js'
export { SecretHandle } from './types/index.js'

export type {
  Vault,
  CredentialRecord,
  CredentialType,
  SecretFields,
  PublicCredentialMetadata,
  PolicyConfig,
  PolicyDecision,
  Decision,
  RiskLevel,
  ToolCallRequest,
  ApprovedExecutionRequest,
  RawExecutionResult,
  ConfirmationRequest,
  ConfirmationResponse,
  RedactionRule,
  AuditEntry,
  ToolName,
  AppConfig,
} from './types/index.js'

/**
 * Policy Engine Module
 *
 * Evaluates AI-requested operations against a local policy file.
 * Returns allow/deny/confirm decisions with risk levels.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getPolicyPath, ensureBaseDir } from '../utils/paths.js'
import type {
  PolicyConfig,
  PolicyDecision,
  RiskLevel,
  ToolName,
  ToolPolicy,
  TargetPolicy,
} from '../types/index.js'

const DEFAULT_DENY_PATTERNS = [
  'rm -rf',
  'chmod 777',
  'curl',
  'wget',
  '| bash',
  '| sh',
  '| zsh',
  'cat ~/.ssh',
  'printenv',
  'env',
  'history',
  'kubectl get secrets',
  'aws secretsmanager get-secret-value',
  'gcloud secrets versions access',
  'vault read',
  'cat .env',
  'cat ~/.kube/config',
]

const CRITICAL_TOOLS: ToolName[] = ['run_safe_command']
const HIGH_RISK_TOOLS: ToolName[] = ['deploy_project', 'restart_service', 'upload_file']
const MEDIUM_RISK_TOOLS: ToolName[] = ['run_safe_command', 'call_api']
const LOW_RISK_TOOLS: ToolName[] = ['list_servers', 'check_service_status', 'view_logs']

export class PolicyEngine {
  private config: PolicyConfig | null = null

  /**
   * Load policy from the default policy file.
   */
  async load(): Promise<void> {
    ensureBaseDir()
    const policyPath = getPolicyPath()

    if (!existsSync(policyPath)) {
      // Use default permissive policy
      this.config = this.getDefaultPolicy()
      return
    }

    const content = await readFile(policyPath, 'utf-8')
    this.config = this.parseYamlLike(content)
  }

  /**
   * Evaluate a tool call request against the policy.
   */
  async evaluate(
    tool: ToolName,
    target?: string,
    args?: Record<string, unknown>
  ): Promise<PolicyDecision> {
    if (!this.config) {
      await this.load()
    }

    const cfg = this.config!
    const toolPolicy = cfg.tools?.[tool]
    const targetPolicy = target ? cfg.targets?.[target] : undefined

    // Check mode
    if (cfg.mode === 'read_only') {
      if (!LOW_RISK_TOOLS.includes(tool)) {
        return {
          decision: 'deny',
          reason: 'Policy is in read-only mode',
          riskLevel: 'high',
        }
      }
    }

    // Check if tool is allowed
    if (toolPolicy && !toolPolicy.allowed) {
      return {
        decision: 'deny',
        reason: `Tool '${tool}' is not allowed by policy`,
        riskLevel: 'medium',
      }
    }

    // Check target-specific tool restrictions
    if (targetPolicy) {
      if (targetPolicy.deniedTools?.includes(tool)) {
        return {
          decision: 'deny',
          reason: `Tool '${tool}' is denied for target '${target}'`,
          riskLevel: 'high',
        }
      }
      if (targetPolicy.allowedTools && !targetPolicy.allowedTools.includes(tool)) {
        return {
          decision: 'deny',
          reason: `Tool '${tool}' is not in allowed tools for target '${target}'`,
          riskLevel: 'medium',
        }
      }
    }

    // Check command-level deny patterns
    if (tool === 'run_safe_command' && args?.command) {
      const command = String(args.command)
      const patterns = toolPolicy?.deniedPatterns ?? DEFAULT_DENY_PATTERNS
      for (const pattern of patterns) {
        if (command.toLowerCase().includes(pattern.toLowerCase())) {
          return {
            decision: 'deny',
            reason: `Command denied by policy: matches pattern '${pattern}'`,
            riskLevel: 'critical',
          }
        }
      }
    }

    // Check allowed services for restart_service
    if (tool === 'restart_service' && args?.service) {
      const service = String(args.service)
      const allowedServices = toolPolicy?.allowedServices
      if (allowedServices && !allowedServices.includes(service)) {
        return {
          decision: 'deny',
          reason: `Service '${service}' is not in allowed services list`,
          riskLevel: 'medium',
        }
      }
    }

    // Check allowed targets
    if (toolPolicy?.allowedTargets && target) {
      if (!toolPolicy.allowedTargets.includes(target)) {
        return {
          decision: 'deny',
          reason: `Target '${target}' is not allowed for tool '${tool}'`,
          riskLevel: 'medium',
        }
      }
    }

    // Determine risk level
    const riskLevel = this.determineRiskLevel(tool, target, targetPolicy)

    // Determine if confirmation is needed
    const needsConfirmation = this.needsConfirmation(tool, target, riskLevel, toolPolicy, targetPolicy)

    if (needsConfirmation) {
      return {
        decision: 'confirm',
        reason: `Operation requires confirmation (risk: ${riskLevel})`,
        riskLevel,
      }
    }

    return {
      decision: 'allow',
      reason: 'Operation allowed by policy',
      riskLevel,
    }
  }

  /**
   * Get the current policy config (for display).
   */
  getConfig(): PolicyConfig | null {
    return this.config
  }

  // ─── Private ──────────────────────────────────────────────────────

  private determineRiskLevel(
    tool: ToolName,
    _target?: string,
    targetPolicy?: TargetPolicy
  ): RiskLevel {
    const env = targetPolicy?.environment

    // Critical tools
    if (CRITICAL_TOOLS.includes(tool)) return 'critical'

    // Production is always high risk
    if (env === 'production') {
      if (HIGH_RISK_TOOLS.includes(tool)) return 'high'
      if (MEDIUM_RISK_TOOLS.includes(tool)) return 'high'
      return 'medium'
    }

    // Staging
    if (env === 'staging') {
      if (HIGH_RISK_TOOLS.includes(tool)) return 'medium'
      if (LOW_RISK_TOOLS.includes(tool)) return 'low'
      return 'medium'
    }

    // Default risk by tool
    if (HIGH_RISK_TOOLS.includes(tool)) return 'high'
    if (MEDIUM_RISK_TOOLS.includes(tool)) return 'medium'
    return 'low'
  }

  private needsConfirmation(
    tool: ToolName,
    _target?: string,
    riskLevel?: RiskLevel,
    toolPolicy?: ToolPolicy,
    targetPolicy?: TargetPolicy
  ): boolean {
    // Critical always requires confirmation
    if (riskLevel === 'critical') return true

    // Tool-specific require_confirmation
    if (toolPolicy?.requireConfirmation === true) return true

    // Target-specific: require confirmation for all
    if (targetPolicy?.requireConfirmationForAll) return true

    // Target-specific: allow without confirmation list
    if (targetPolicy?.allowWithoutConfirmation?.includes(tool)) return false

    // Default: high risk needs confirmation
    if (riskLevel === 'high') return true

    // Default: low risk no confirmation
    if (riskLevel === 'low') return false

    // Medium risk: depends on defaults
    return this.config?.defaults?.requireConfirmation ?? true
  }

  private getDefaultPolicy(): PolicyConfig {
    return {
      version: 1,
      defaults: {
        requireConfirmation: true,
        returnOutput: 'redacted',
      },
      targets: {
        staging: {
          environment: 'staging',
          allowWithoutConfirmation: ['check_service_status', 'view_logs'],
        },
        prod: {
          environment: 'production',
          requireConfirmationForAll: true,
        },
      },
      tools: {
        list_servers: { allowed: true },
        check_service_status: { allowed: true },
        view_logs: {
          allowed: true,
          maxLines: 300,
          redactOutput: true,
        },
        restart_service: {
          allowed: true,
          requireConfirmation: true,
          allowedServices: ['web', 'worker', 'nginx'],
        },
        deploy_project: {
          allowed: true,
          requireConfirmation: true,
          allowedTargets: ['staging', 'prod'],
        },
        upload_file: {
          allowed: true,
          requireConfirmation: true,
        },
        run_safe_command: {
          allowed: true,
          requireConfirmation: true,
          deniedPatterns: DEFAULT_DENY_PATTERNS,
        },
        call_api: {
          allowed: true,
          requireConfirmation: true,
          allowedTargets: ['staging', 'prod', 'test-api', 'test-api-wrong'],
        },
      },
    }
  }

  /**
   * Simple YAML-like parser for policy files.
   * For MVP, this handles the basic structure.
   * In production, use a proper YAML parser.
   */
  private parseYamlLike(content: string): PolicyConfig {
    // For MVP, we use a simple approach.
    // The policy file is expected to be valid JSON or YAML.
    // We try JSON first, then fall back to a basic YAML parse.
    try {
      return JSON.parse(content) as PolicyConfig
    } catch {
      // For now, return default if JSON parse fails
      // TODO: Implement proper YAML parsing or use js-yaml
      return this.getDefaultPolicy()
    }
  }
}

/**
 * Factory function to create a policy engine.
 */
export function createPolicyEngine(): PolicyEngine {
  return new PolicyEngine()
}

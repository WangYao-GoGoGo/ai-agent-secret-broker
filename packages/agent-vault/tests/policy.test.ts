/**
 * Policy Engine Tests
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PolicyEngine, createPolicyEngine } from '../src/policy/index.js'

describe('PolicyEngine', () => {
  let engine: PolicyEngine

  beforeAll(async () => {
    engine = createPolicyEngine()
    await engine.load()
  })

  it('should allow list_servers', async () => {
    const result = await engine.evaluate('list_servers')
    expect(result.decision).toBe('allow')
    expect(result.riskLevel).toBe('low')
  })

  it('should allow check_service_status on staging', async () => {
    const result = await engine.evaluate('check_service_status', 'staging')
    expect(result.decision).toBe('allow')
    expect(result.riskLevel).toBe('low')
  })

  it('should require confirmation for deploy_project on prod', async () => {
    const result = await engine.evaluate('deploy_project', 'prod')
    expect(result.decision).toBe('confirm')
    expect(result.riskLevel).toBe('high')
  })

  it('should deny dangerous commands', async () => {
    const result = await engine.evaluate('run_safe_command', 'staging', {
      command: 'cat ~/.ssh/id_rsa',
    })
    expect(result.decision).toBe('deny')
    expect(result.riskLevel).toBe('critical')
  })

  it('should deny rm -rf commands', async () => {
    const result = await engine.evaluate('run_safe_command', 'staging', {
      command: 'rm -rf /var/www',
    })
    expect(result.decision).toBe('deny')
  })

  it('should allow safe commands on staging', async () => {
    const result = await engine.evaluate('run_safe_command', 'staging', {
      command: 'ls -la /var/www',
    })
    // Should require confirmation but not deny
    expect(result.decision).not.toBe('deny')
  })

  it('should deny restart_service for unallowed services', async () => {
    const result = await engine.evaluate('restart_service', 'staging', {
      service: 'mysql',
    })
    expect(result.decision).toBe('deny')
  })

  it('should allow restart_service for allowed services', async () => {
    const result = await engine.evaluate('restart_service', 'staging', {
      service: 'web',
    })
    expect(result.decision).not.toBe('deny')
  })

  it('should deny deploy_project to unallowed targets', async () => {
    const result = await engine.evaluate('deploy_project', 'dev')
    expect(result.decision).toBe('deny')
  })
})

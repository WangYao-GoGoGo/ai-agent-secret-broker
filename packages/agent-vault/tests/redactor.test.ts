/**
 * Output Redactor Tests
 */

import { describe, it, expect } from 'vitest'
import { OutputRedactor, createRedactor } from '../src/redactor/index.js'
import { SecretHandle } from '../src/types/index.js'

describe('OutputRedactor', () => {
  it('should redact private IP addresses', () => {
    const redactor = createRedactor()
    const result = redactor.redact('Connected to 192.168.1.100')
    expect(result).toContain('<PRIVATE_IP>')
    expect(result).not.toContain('192.168.1.100')
  })

  it('should redact public IP addresses', () => {
    const redactor = createRedactor()
    const result = redactor.redact('Server at 203.0.113.10')
    expect(result).toContain('<IP>')
    expect(result).not.toContain('203.0.113.10')
  })

  it('should redact email addresses', () => {
    const redactor = createRedactor()
    const result = redactor.redact('Contact: admin@example.com')
    expect(result).toContain('<EMAIL>')
    expect(result).not.toContain('admin@example.com')
  })

  it('should redact JWT tokens', () => {
    const redactor = createRedactor()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8'
    const result = redactor.redact(`Token: ${jwt}`)
    expect(result).toContain('<JWT>')
    expect(result).not.toContain(jwt)
  })

  it('should redact AWS access keys', () => {
    const redactor = createRedactor()
    const result = redactor.redact('AKIAIOSFODNN7EXAMPLE')
    expect(result).toContain('<AWS_KEY>')
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })

  it('should redact GitHub tokens', () => {
    const redactor = createRedactor()
    const result = redactor.redact('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(result).toContain('<GITHUB_TOKEN>')
  })

  it('should redact SSH private key markers', () => {
    const redactor = createRedactor()
    const keyContent = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABFwAAAAdzc2gtcn
NhAAAAAwEAAQAAAQEA6NF1QAAAAP////8BAgMEBQYHCAkKCwwNDg8Q==
-----END OPENSSH PRIVATE KEY-----`
    const result = redactor.redact(keyContent)
    expect(result).toContain('<PRIVATE_KEY>')
    expect(result).not.toContain('OPENSSH PRIVATE KEY')
  })

  it('should redact database URLs', () => {
    const redactor = createRedactor()
    const result = redactor.redact('postgres://admin:pass123@10.0.0.5:5432/app')
    expect(result).toContain('<DB_URL>')
    expect(result).not.toContain('admin:pass123')
  })

  it('should redact URL embedded credentials', () => {
    const redactor = createRedactor()
    const result = redactor.redact('http://user:password@example.com/api')
    expect(result).toContain('://<USER>:<PASS>@')
    expect(result).not.toContain('user:password')
  })

  it('should redact known vault values', () => {
    const redactor = createRedactor()
    const handle = new SecretHandle('prod', {
      host: '203.0.113.50',
      user: 'deploy-user',
    })
    redactor.registerVaultSecrets(handle)

    const result = redactor.redact('Connected as deploy-user to 203.0.113.50')
    expect(result).toContain('<USER>')
    expect(result).toContain('<HOST>')
    expect(result).not.toContain('deploy-user')
    expect(result).not.toContain('203.0.113.50')
  })

  it('should handle empty text', () => {
    const redactor = createRedactor()
    expect(redactor.redact('')).toBe('')
  })

  it('should handle text with no sensitive data', () => {
    const redactor = createRedactor()
    const text = 'Hello, this is a normal log message.'
    expect(redactor.redact(text)).toBe(text)
  })
})

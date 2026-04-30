/**
 * SSH Execution Adapter
 *
 * Performs operations on remote servers via SSH.
 * Receives credentials internally from the broker (never from AI).
 */

import { Client, type ConnectConfig } from 'ssh2'
import type { SecretHandle, RawExecutionResult } from '../types/index.js'

export interface SshCommandOptions {
  command: string
  timeout?: number
}

export interface SshUploadOptions {
  localPath: string
  remotePath: string
}

export class SshAdapter {
  /**
   * Execute a command on a remote server via SSH.
   */
  async executeCommand(
    secretHandle: SecretHandle,
    options: SshCommandOptions
  ): Promise<RawExecutionResult> {
    const config = this.buildConfig(secretHandle)
    const client = new Client()

    return new Promise((resolve, reject) => {
      const timeout = options.timeout ?? 30_000
      let stdout = ''
      let stderr = ''

      const timer = setTimeout(() => {
        client.end()
        reject(new Error(`SSH command timed out after ${timeout}ms`))
      }, timeout)

      client.on('ready', () => {
        client.exec(options.command, (err: Error | undefined, stream: any) => {
          if (err) {
            clearTimeout(timer)
            client.end()
            reject(err)
            return
          }

          stream.on('close', (code: number) => {
            clearTimeout(timer)
            client.end()
            resolve({
              success: code === 0,
              stdout,
              stderr,
              exitCode: code,
            })
          })

          stream.on('data', (data: Buffer) => {
            stdout += data.toString('utf-8')
          })

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString('utf-8')
          })
        })
      })

      client.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })

      client.connect(config)
    })
  }

  /**
   * Upload a file to a remote server via SFTP.
   */
  async uploadFile(
    secretHandle: SecretHandle,
    options: SshUploadOptions
  ): Promise<RawExecutionResult> {
    const config = this.buildConfig(secretHandle)
    const client = new Client()
    const { basename } = await import('node:path')

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end()
        reject(new Error('SFTP upload timed out'))
      }, 60_000)

      client.on('ready', () => {
        client.sftp((err: Error | undefined, sftp: any) => {
          if (err) {
            clearTimeout(timer)
            client.end()
            reject(err)
            return
          }

          const remotePath = options.remotePath.endsWith('/')
            ? options.remotePath + basename(options.localPath)
            : options.remotePath

          sftp.fastPut(options.localPath, remotePath, (putErr: Error | undefined) => {
            clearTimeout(timer)
            if (putErr) {
              client.end()
              reject(putErr)
              return
            }
            client.end()
            resolve({
              success: true,
              stdout: `File uploaded to ${remotePath}`,
              stderr: '',
              exitCode: 0,
            })
          })
        })
      })

      client.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })

      client.connect(config)
    })
  }

  /**
   * Test SSH connectivity.
   */
  async checkConnection(secretHandle: SecretHandle): Promise<boolean> {
    try {
      const result = await this.executeCommand(secretHandle, {
        command: 'echo "connected"',
        timeout: 10_000,
      })
      return result.success && result.stdout.includes('connected')
    } catch {
      return false
    }
  }

  /**
   * Build SSH connection config from a SecretHandle.
   */
  private buildConfig(handle: SecretHandle): ConnectConfig {
    const config: ConnectConfig = {
      host: String(handle.get('host') ?? 'localhost'),
      port: Number(handle.get('port') ?? 22),
      username: String(handle.get('user') ?? 'root'),
      readyTimeout: 10_000,
    }

    const privateKey = handle.get('privateKey')
    const password = handle.get('password')

    if (privateKey && typeof privateKey === 'string') {
      config.privateKey = privateKey
    } else if (password && typeof password === 'string') {
      config.password = password
    }

    return config
  }
}

/**
 * Factory function to create an SSH adapter.
 */
export function createSshAdapter(): SshAdapter {
  return new SshAdapter()
}

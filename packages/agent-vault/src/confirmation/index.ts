/**
 * Confirmation Layer Module
 *
 * Handles user confirmation prompts for sensitive operations.
 * MVP uses CLI prompts. Future versions may use desktop notifications.
 */

import enquirer from 'enquirer'
import type { ConfirmationRequest, ConfirmationResponse } from '../types/index.js'

const RISK_COLORS: Record<string, string> = {
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
}

export class ConfirmationLayer {
  private clientName: string

  constructor(clientName: string = 'AI Agent') {
    this.clientName = clientName
  }

  /**
   * Ask the user to confirm an operation.
   * Returns the user's decision.
   */
  async requestConfirmation(request: ConfirmationRequest): Promise<ConfirmationResponse> {
    const promptText = this.formatPrompt(request)

    console.log('\n' + '='.repeat(60))
    console.log(promptText)
    console.log('='.repeat(60) + '\n')

    try {
      const response = await enquirer.prompt<{ action: string }>({
        type: 'select',
        name: 'action',
        message: 'Allow this operation?',
        choices: [
          { name: 'allow_once', message: '✅ Allow once' },
          { name: 'deny', message: '❌ Deny' },
        ],
      })

      return response.action as ConfirmationResponse
    } catch {
      // User pressed Ctrl+C or closed the prompt
      return 'deny'
    }
  }

  /**
   * Format a confirmation prompt for display.
   */
  private formatPrompt(request: ConfirmationRequest): string {
    return [
      `🔐  ${this.clientName} requests operation:`,
      '',
      `   Tool:       ${request.tool}`,
      `   Target:     ${request.target}`,
      `   Environment: ${request.environment}`,
      `   Risk:       ${RISK_COLORS[request.riskLevel] || request.riskLevel}`,
      `   Summary:    ${request.summary}`,
      '',
      `   Policy:     ${request.policyReason}`,
    ].join('\n')
  }
}

/**
 * Factory function to create a confirmation layer.
 */
export function createConfirmationLayer(clientName?: string): ConfirmationLayer {
  return new ConfirmationLayer(clientName)
}

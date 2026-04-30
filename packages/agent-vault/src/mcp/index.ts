/**
 * MCP Server Module
 *
 * Exposes broker capabilities to AI coding agents via the Model Context Protocol.
 * Compatible with Cursor, Roo Code, Claude Desktop, and other MCP clients.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { SecretBroker } from '../broker.js'
import type { ToolCallRequest, ToolName } from '../types/index.js'

const TOOL_DEFINITIONS = [
  {
    name: 'list_servers',
    description: 'List all configured server aliases and their environments. Use this to discover available deployment targets.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'check_service_status',
    description: 'Check the status of a service on a remote server.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        service: {
          type: 'string',
          description: 'Service name (e.g., web, worker, nginx)',
        },
      },
      required: ['target', 'service'],
    },
  },
  {
    name: 'view_logs',
    description: 'View recent logs from a service on a remote server. Logs are automatically redacted to remove sensitive information.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        service: {
          type: 'string',
          description: 'Service name to fetch logs for',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to fetch (max 300)',
          default: 100,
        },
      },
      required: ['target', 'service'],
    },
  },
  {
    name: 'restart_service',
    description: 'Restart a service on a remote server. Requires user confirmation for production targets.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        service: {
          type: 'string',
          description: 'Service name to restart (e.g., web, worker, nginx)',
        },
      },
      required: ['target', 'service'],
    },
  },
  {
    name: 'deploy_project',
    description: 'Deploy a project to a remote server. Uses the server\'s configured deployment path. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        strategy: {
          type: 'string',
          description: 'Deployment strategy',
          enum: ['docker_compose', 'npm', 'git_pull'],
          default: 'docker_compose',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a file to a remote server. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        local_path: {
          type: 'string',
          description: 'Local file path to upload',
        },
      },
      required: ['target', 'local_path'],
    },
  },
  {
    name: 'run_safe_command',
    description: 'Run a safe command on a remote server. Dangerous commands are blocked by policy. Requires user confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Server alias (e.g., staging, prod)',
        },
        command: {
          type: 'string',
          description: 'Command to execute',
        },
      },
      required: ['target', 'command'],
    },
  },
  {
    name: 'call_api',
    description: 'Call an external API using a stored credential. The API key is automatically injected from the vault and never exposed to the AI agent. Use this to interact with OpenAI, GitHub, or any REST API that uses token-based auth.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Credential alias (e.g., openai, github, my-api)',
        },
        method: {
          type: 'string',
          description: 'HTTP method',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET',
        },
        path: {
          type: 'string',
          description: 'API path (e.g., /v1/chat/completions, /user, /repos)',
        },
        headers: {
          type: 'object',
          description: 'Additional HTTP headers (optional). The Authorization header is automatically set from the vault.',
        },
        body: {
          type: 'object',
          description: 'Request body as JSON object (optional, for POST/PUT/PATCH)',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 30000)',
          default: 30000,
        },
      },
      required: ['target', 'path'],
    },
  },
]

export class McpServer {
  private server: Server
  private broker: SecretBroker
  private transport: StdioServerTransport | null = null

  constructor(broker: SecretBroker) {
    this.broker = broker

    this.server = new Server(
      {
        name: 'agent-vault',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.setupHandlers()
  }

  /**
   * Start the MCP server using stdio transport.
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport()
    await this.server.connect(this.transport)
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    await this.server.close()
  }

  /**
   * Set up MCP request handlers.
   */
  private setupHandlers(): void {
    // Handle ListTools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS,
    }))

    // Handle CallTool request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name as ToolName
      const args = request.params.arguments ?? {}

      // Map MCP argument names to internal names
      const mappedArgs: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(args)) {
        // Convert snake_case MCP args to camelCase internal args
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        mappedArgs[camelKey] = value
      }

      const toolRequest: ToolCallRequest = {
        tool: toolName,
        target: (mappedArgs.target as string) ?? undefined,
        args: mappedArgs,
      }

      try {
        const result = await this.broker.processRequest(toolRequest)

        return {
          content: [
            {
              type: 'text',
              text: result.result,
            },
          ],
          isError: !result.success,
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMsg}`,
            },
          ],
          isError: true,
        }
      }
    })
  }
}

/**
 * Factory function to create and start an MCP server.
 */
export async function startMcpServer(broker: SecretBroker): Promise<McpServer> {
  const server = new McpServer(broker)
  await server.start()
  return server
}

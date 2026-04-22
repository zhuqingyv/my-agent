import { loadConfigDetailed, resolveConfigPath } from './config.js';
import { connectMcpServer } from './mcp/client.js';
import { createAgent } from './agent.js';
import type { AgentConfig, McpConnection, Agent, McpServerConfig } from './mcp/types.js';

export interface BootstrapResult {
  config: AgentConfig;
  configPath: string | null;
  configSources: string[];
  createdDefault: boolean;
  connections: McpConnection[];
  agent: Agent;
}

export async function bootstrap(configPath?: string): Promise<BootstrapResult> {
  const { config, sources, createdDefault } = loadConfigDetailed(configPath);
  const resolved = resolveConfigPath(configPath);

  const entries = Object.entries(config.mcpServers ?? {}) as Array<[string, McpServerConfig]>;
  const connections: McpConnection[] = [];
  for (const [name, serverConfig] of entries) {
    try {
      const conn = await connectMcpServer(name, serverConfig);
      connections.push(conn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\x1b[33m[warn] mcp "${name}" failed to connect: ${msg}\x1b[0m\n`);
    }
  }

  const agent = await createAgent(config, connections);

  return { config, configPath: resolved, configSources: sources, createdDefault, connections, agent };
}

export async function shutdown(connections: McpConnection[]): Promise<void> {
  for (const conn of connections) {
    try {
      await conn.close();
    } catch {
      /* ignore */
    }
  }
}

export { loadConfig, loadConfigDetailed, resolveConfigPath } from './config.js';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PostconditionRuntime } from './runtime.js';
import { createPostconditionServer } from './server.js';

export async function startServer(): Promise<void> {
  const runtime = new PostconditionRuntime();
  const server = createPostconditionServer(runtime);
  const transport = new StdioServerTransport();
  const shutdown = () => {
    runtime.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await server.connect(transport);
  } catch (error) {
    console.error('[postcondition] MCP server failed:', error);
    runtime.close();
    process.exitCode = 1;
  }
}

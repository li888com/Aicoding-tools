#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closePool } from "./database.js";
import { registerAiCodingStatsTools } from "./tools/ai-coding-stats.js";
import { registerFeishuDocsTools } from "./tools/feishu-docs.js";
import { registerFileDecryptTools } from "./tools/file-decrypt.js";

const server = new McpServer({
  name: "mcp-toolbox",
  version: "0.1.0"
});

registerAiCodingStatsTools(server);
registerFeishuDocsTools(server);
registerFileDecryptTools(server);

const transport = new StdioServerTransport();

process.on("SIGINT", () => {
  void closePool().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closePool().finally(() => process.exit(0));
});

await server.connect(transport);

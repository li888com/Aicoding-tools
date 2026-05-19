import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env,
  stderr: "pipe",
});

const client = new Client({
  name: "mcp-toolbox-record-round-test",
  version: "0.1.0",
});

try {
  await client.connect(transport);

  const now = Date.now();
  const promptText = process.argv[2] || "MCP call smoke test #44";
  const result = await client.callTool({
    name: "record_ai_coding_round",
    arguments: {
      conversationId: "codex:C:/Users/00232924/Desktop/mcp",
      startedAt: new Date(now - 5_000).toISOString(),
      endedAt: new Date(now).toISOString(),
      modelName: "gpt-5-codex",
      promptText,
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      codeLinesChanged: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      metadata: {
        client: "codex",
        source: "scripts/call-record-round-via-mcp.ts",
        tokenStatsUnavailable: true,
      },
    },
  });

  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
} finally {
  await client.close();
}

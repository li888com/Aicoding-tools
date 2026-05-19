import "dotenv/config";
import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  const codeStats = await loadCodeStats();
  const result = await client.callTool({
    name: "record_ai_coding_round",
    arguments: {
      conversationId: "codex:C:/Users/00232924/Desktop/mcp",
      startedAt: new Date(now - 5_000).toISOString(),
      endedAt: new Date(now).toISOString(),
      modelName: "gpt-5-codex",
      promptText,
      filesChanged: codeStats.filesChanged,
      linesAdded: codeStats.linesAdded,
      linesDeleted: codeStats.linesDeleted,
      codeLinesChanged: codeStats.codeLinesChanged,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      metadata: {
        client: "codex",
        projectPath: "C:/Users/00232924/Desktop/mcp",
        source: "scripts/call-record-round-via-mcp.ts",
        ...(codeStats.metadata ?? {}),
        tokenStatsUnavailable: true,
      },
    },
  });

  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
} finally {
  await client.close();
}

async function loadCodeStats(): Promise<{
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  codeLinesChanged: number;
  metadata?: Record<string, unknown>;
}> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/code-change-stats.ts",
      "--metadata",
    ], {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as {
      filesChanged?: number;
      linesAdded?: number;
      linesDeleted?: number;
      codeLinesChanged?: number;
      metadata?: Record<string, unknown>;
    };
    return {
      filesChanged: Number(parsed.filesChanged ?? 0),
      linesAdded: Number(parsed.linesAdded ?? 0),
      linesDeleted: Number(parsed.linesDeleted ?? 0),
      codeLinesChanged: Number(parsed.codeLinesChanged ?? 0),
      metadata: parsed.metadata,
    };
  } catch (error) {
    return {
      filesChanged: 0,
      linesAdded: 0,
      linesDeleted: 0,
      codeLinesChanged: 0,
      metadata: {
        codeStatsSource: "unavailable",
        codeStatsError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

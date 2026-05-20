import "dotenv/config";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
type RecordRoundPayload = {
  conversationId?: string;
  startedAt?: string;
  endedAt?: string;
  modelName?: string;
  promptText?: string;
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  codeLinesChanged?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  metadata?: Record<string, unknown>;
};

type CliOptions = {
  allowCodeStatsOverride: boolean;
  payloadFile?: string;
  promptText: string;
};

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
  const options = parseCliOptions(process.argv.slice(2));
  const payload = await loadPayload(options, now);
  const codeStats = await loadCodeStats();
  const payloadOverridesCodeStats = options.allowCodeStatsOverride && hasPayloadCodeStats(payload);
  const result = await client.callTool({
    name: "record_ai_coding_round",
    arguments: {
      conversationId: payload.conversationId ?? "codex:C:/Users/00232924/Desktop/mcp",
      startedAt: payload.startedAt ?? new Date(now - 5_000).toISOString(),
      endedAt: payload.endedAt ?? new Date(now).toISOString(),
      modelName: payload.modelName ?? "gpt-5-codex",
      promptText: payload.promptText ?? "MCP call smoke test #44",
      filesChanged: payloadOverridesCodeStats ? payload.filesChanged ?? codeStats.filesChanged : codeStats.filesChanged,
      linesAdded: payloadOverridesCodeStats ? payload.linesAdded ?? codeStats.linesAdded : codeStats.linesAdded,
      linesDeleted: payloadOverridesCodeStats ? payload.linesDeleted ?? codeStats.linesDeleted : codeStats.linesDeleted,
      codeLinesChanged: payloadOverridesCodeStats ? payload.codeLinesChanged ?? codeStats.codeLinesChanged : codeStats.codeLinesChanged,
      inputTokens: payload.inputTokens ?? 0,
      outputTokens: payload.outputTokens ?? 0,
      totalTokens: payload.totalTokens ?? 0,
      metadata: {
        client: "codex",
        projectPath: "C:/Users/00232924/Desktop/mcp",
        source: "scripts/call-record-round-via-mcp.ts",
        ...(codeStats.metadata ?? {}),
        payloadCodeStatsOverride: payloadOverridesCodeStats,
        ...(payload.metadata ?? {}),
        tokenStatsUnavailable: true,
      },
    },
  });

  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
} finally {
  await client.close();
}

function parseCliOptions(argv: string[]): CliOptions {
  const promptParts: string[] = [];
  let payloadFile: string | undefined;
  let allowCodeStatsOverride = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--payload-file") {
      payloadFile = argv[index + 1];
      if (!payloadFile) {
        throw new Error("--payload-file requires a UTF-8 JSON file path");
      }
      index += 1;
    } else if (arg === "--allow-code-stats-override") {
      allowCodeStatsOverride = true;
    } else {
      promptParts.push(arg);
    }
  }

  return {
    allowCodeStatsOverride,
    payloadFile,
    promptText: promptParts.join(" ").trim(),
  };
}

async function loadPayload(options: CliOptions, now: number): Promise<RecordRoundPayload> {
  if (options.payloadFile) {
    return JSON.parse(await readFile(options.payloadFile, "utf8")) as RecordRoundPayload;
  }

  return {
    startedAt: new Date(now - 5_000).toISOString(),
    endedAt: new Date(now).toISOString(),
    promptText: options.promptText || "MCP call smoke test #44",
  };
}

function hasPayloadCodeStats(payload: RecordRoundPayload): boolean {
  return payload.filesChanged !== undefined ||
    payload.linesAdded !== undefined ||
    payload.linesDeleted !== undefined ||
    payload.codeLinesChanged !== undefined;
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

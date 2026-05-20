import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const storageDir = join(tmpdir(), `mcp-toolbox-record-round-utf8-${process.pid}-${Date.now()}`);
const payloadFile = join(storageDir, "payload.json");
const promptText = "#888 中文 prompt 不应变成问号";

try {
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    payloadFile,
    JSON.stringify({
      conversationId: "codex:verify-record-round-utf8",
      startedAt: new Date(Date.now() - 1000).toISOString(),
      endedAt: new Date().toISOString(),
      modelName: "verify-model",
      promptText,
      filesChanged: 99,
      linesAdded: 99,
      linesDeleted: 99,
      codeLinesChanged: 198,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      metadata: {
        client: "codex",
        projectPath: process.cwd(),
        tokenStatsUnavailable: true,
      },
    }, null, 2),
    "utf8"
  );

  await execFileAsync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs",
    "scripts/call-record-round-via-mcp.ts",
    "--payload-file",
    payloadFile,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_TOOLBOX_STORAGE_DIR: storageDir,
    },
    maxBuffer: 20 * 1024 * 1024,
  });

  const data = JSON.parse(await readFile(join(storageDir, "data.json"), "utf8")) as {
    rounds?: Array<{
      promptText?: string | null;
      requirementId?: number | null;
      filesChanged?: number | null;
      linesAdded?: number;
      linesDeleted?: number;
      codeLinesChanged?: number;
      metadata?: { payloadCodeStatsOverride?: boolean } | null;
    }>;
  };
  const round = data.rounds?.[0];
  if (!round) {
    throw new Error("No round was recorded");
  }
  if (round.promptText !== promptText) {
    throw new Error(`Prompt text was not preserved: ${JSON.stringify(round.promptText)}`);
  }
  if (round.requirementId !== 888) {
    throw new Error(`Requirement id was not parsed: ${JSON.stringify(round.requirementId)}`);
  }
  if (round.linesAdded === 99 || round.linesDeleted === 99 || round.codeLinesChanged === 198) {
    throw new Error(`Payload code stats unexpectedly overrode automatic stats: ${JSON.stringify(round)}`);
  }
  if (round.metadata?.payloadCodeStatsOverride !== false) {
    throw new Error(`Expected payloadCodeStatsOverride=false: ${JSON.stringify(round.metadata)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    promptText: round.promptText,
    requirementId: round.requirementId,
    codeLinesChanged: round.codeLinesChanged,
    payloadCodeStatsOverride: round.metadata?.payloadCodeStatsOverride,
  }, null, 2));
} finally {
  await rm(storageDir, { recursive: true, force: true });
}

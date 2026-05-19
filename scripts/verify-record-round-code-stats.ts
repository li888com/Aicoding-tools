import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { closePool } from "../src/database.js";
import * as localStorage from "../src/local-storage.js";

const execFileAsync = promisify(execFile);
const originalStorageDir = process.env.MCP_TOOLBOX_STORAGE_DIR;
const verifyStorageDir = path.join(process.cwd(), ".mcp-toolbox", "verify-record-round-code-stats");
process.env.MCP_TOOLBOX_STORAGE_DIR = verifyStorageDir;
localStorage.setStorageDir(verifyStorageDir);

try {
  await rm(verifyStorageDir, { recursive: true, force: true });
  await mkdir(verifyStorageDir, { recursive: true });

  await execFileAsync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs",
    "scripts/call-record-round-via-mcp.ts",
    "#999 verify record round code stats"
  ], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  const rounds = await localStorage.getRounds();
  const round = rounds[0];
  if (!round) {
    throw new Error("Expected one recorded round");
  }

  const summary = round.metadata?.fileCategorySummary;
  if (!summary || typeof summary !== "object") {
    throw new Error(`Missing fileCategorySummary metadata: ${JSON.stringify(round.metadata)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    roundId: round.id,
    filesChanged: round.filesChanged,
    codeLinesChanged: round.codeLinesChanged,
    fileCategorySummary: summary,
  }, null, 2));
} finally {
  if (originalStorageDir === undefined) {
    delete process.env.MCP_TOOLBOX_STORAGE_DIR;
  } else {
    process.env.MCP_TOOLBOX_STORAGE_DIR = originalStorageDir;
  }
  await closePool();
}

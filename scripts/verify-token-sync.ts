import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { closePool, recordRound } from "../src/database.js";
import * as localStorage from "../src/local-storage.js";

const execFileAsync = promisify(execFile);
const projectPath = path.resolve(process.cwd());
const codexDir = path.join(homedir(), ".codex");
const originalStorageDir = process.env.MCP_TOOLBOX_STORAGE_DIR;
const verifyStorageDir = path.join(process.cwd(), ".mcp-toolbox", "verify-token-sync");
process.env.MCP_TOOLBOX_STORAGE_DIR = verifyStorageDir;
localStorage.setStorageDir(verifyStorageDir);

try {
  await rm(verifyStorageDir, { recursive: true, force: true });
  await mkdir(verifyStorageDir, { recursive: true });

  const latestUsage = await latestCodexUsage(projectPath);
  if (!latestUsage) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "No recent Codex token usage log found"
    }, null, 2));
    process.exit(0);
  }

  const startedAt = new Date(latestUsage.startedAt.getTime() - 5_000);
  const endedAt = new Date(latestUsage.endedAt.getTime() + 5_000);
  const round = await recordRound({
    conversationId: `codex:${projectPath}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    modelName: latestUsage.modelName ?? "gpt-5.5",
    promptText: "#999 token sync verification",
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    metadata: {
      client: "codex",
      projectPath,
      threadId: latestUsage.threadId,
      turnId: latestUsage.turnId,
      tokenStatsUnavailable: true
    }
  });

  await execFileAsync(process.execPath, [
    path.join("node_modules", "tsx", "dist", "cli.mjs"),
    path.join("scripts", "sync-token-usage.ts"),
    "--client",
    "codex",
    "--round-id",
    String(round.id),
    "--project",
    projectPath
  ], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024
  });

  const updated = await localStorage.getRound(round.id);
  if (!updated || updated.tokenSyncStatus !== "synced" || Number(updated.totalTokens) <= 0) {
    throw new Error(`Expected round ${round.id} to sync token usage, got ${JSON.stringify(updated)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    roundId: round.id,
    storageDir: verifyStorageDir,
    totalTokens: Number(updated.totalTokens),
    tokenSource: updated.tokenSource,
    tokenSyncStatus: updated.tokenSyncStatus,
    tokenSyncNote: updated.tokenSyncNote
  }, null, 2));
} finally {
  if (originalStorageDir === undefined) {
    delete process.env.MCP_TOOLBOX_STORAGE_DIR;
  } else {
    process.env.MCP_TOOLBOX_STORAGE_DIR = originalStorageDir;
  }
  await closePool();
}

async function latestCodexUsage(projectPath: string): Promise<{
  startedAt: Date;
  endedAt: Date;
  modelName?: string;
  threadId?: string;
  turnId?: string;
} | null> {
  const rolloutUsage = await latestCodexRolloutUsage(projectPath);
  if (rolloutUsage) return rolloutUsage;

  if (!await isSqliteCliAvailable()) return null;

  const threadId = await latestCodexThreadId(projectPath);
  const sql = `
    SELECT ts, feedback_log_body
    FROM logs
    WHERE ts >= ${Math.floor(Date.now() / 1000) - 6 * 60 * 60}
      AND target = 'codex_core::session::turn'
      AND feedback_log_body LIKE '%:run_turn: post sampling token usage%'
      AND feedback_log_body LIKE '%thread.id=${threadId}%'
    ORDER BY id DESC
    LIMIT 1
  `;
  const { stdout } = await execFileAsync("sqlite3", [
    "-json",
    path.join(codexDir, "logs_2.sqlite"),
    sql
  ], {
    maxBuffer: 20 * 1024 * 1024
  });

  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  const row = rows[0];
  if (!row) return null;

  return {
    startedAt: new Date((Number(row.ts) - 30) * 1000),
    endedAt: new Date((Number(row.ts) + 30) * 1000),
    modelName: String(row.feedback_log_body ?? "").match(/model=([^}: ]+)/)?.[1],
    threadId,
    turnId: String(row.feedback_log_body ?? "").match(/turn_id=([0-9a-f-]+)/)?.[1]
  };
}

async function latestCodexRolloutUsage(projectPath: string): Promise<{
  startedAt: Date;
  endedAt: Date;
  modelName?: string;
  threadId?: string;
  turnId?: string;
} | null> {
  const files = await findCodexRolloutFiles();
  let latest: {
    startedAt: Date;
    endedAt: Date;
    modelName?: string;
    threadId?: string;
    turnId?: string;
  } | null = null;

  for (const file of files) {
    let activeTurn: {
      turnId: string;
      cwd?: string;
      modelName?: string;
      startedAt: Date;
      hasTokenUsage: boolean;
    } | null = null;

    for await (const event of readJsonLines(file)) {
      if (!isObject(event) || !isObject(event.payload)) continue;
      const timestamp = new Date(String(event.timestamp ?? ""));
      const payload = event.payload;
      const payloadType = stringValue(payload.type);

      if (event.type === "event_msg" && payloadType === "task_started") {
        const turnId = stringValue(payload.turn_id);
        if (!turnId) continue;
        activeTurn = {
          turnId,
          startedAt: timestamp,
          hasTokenUsage: false
        };
        continue;
      }

      if (event.type === "turn_context" && activeTurn) {
        const turnId = stringValue(payload.turn_id);
        if (turnId !== activeTurn.turnId) continue;
        activeTurn.cwd = stringValue(payload.cwd);
        activeTurn.modelName = stringValue(payload.model);
        continue;
      }

      if (event.type === "event_msg" && payloadType === "token_count" && activeTurn) {
        activeTurn.hasTokenUsage = true;
        continue;
      }

      if (event.type === "event_msg" && payloadType === "task_complete" && activeTurn) {
        const turnId = stringValue(payload.turn_id);
        if (turnId !== activeTurn.turnId) continue;
        if (activeTurn.hasTokenUsage && isSameOrChildPath(activeTurn.cwd, projectPath)) {
          const candidate = {
            startedAt: activeTurn.startedAt,
            endedAt: timestamp,
            modelName: activeTurn.modelName,
            threadId: extractCodexThreadIdFromRolloutPath(file),
            turnId: activeTurn.turnId
          };
          if (!latest || candidate.endedAt.getTime() > latest.endedAt.getTime()) {
            latest = candidate;
          }
        }
        activeTurn = null;
      }
    }
  }

  return latest;
}

async function latestCodexThreadId(projectPath: string): Promise<string> {
  const { stdout } = await execFileAsync("sqlite3", [
    "-json",
    path.join(codexDir, "state_5.sqlite"),
    `SELECT id FROM threads WHERE cwd = '${projectPath.replaceAll("'", "''")}' ORDER BY updated_at_ms DESC, updated_at DESC LIMIT 1`
  ], {
    maxBuffer: 1024 * 1024
  });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`No Codex thread found for ${projectPath}`);
  }
  return String(id);
}

async function isSqliteCliAvailable(): Promise<boolean> {
  try {
    await execFileAsync("sqlite3", ["--version"], {
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined;
    if (code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function findCodexRolloutFiles(): Promise<string[]> {
  const roots = [
    path.join(codexDir, "sessions"),
    path.join(codexDir, "archived_sessions")
  ];
  const files: string[] = [];
  for (const root of roots) {
    files.push(...await walkFiles(root, ".jsonl"));
  }
  return files;
}

async function walkFiles(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function* readJsonLines(filePath: string): AsyncGenerator<unknown> {
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Ignore malformed historical log lines.
    }
  }
}

function extractCodexThreadIdFromRolloutPath(filePath: string): string | undefined {
  const match = path.basename(filePath).match(/rollout-.+?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
  return match?.[1];
}

function isSameOrChildPath(value: string | undefined, parent: string | undefined): boolean {
  if (!value || !parent) return false;
  const normalizedValue = normalizeComparablePath(path.resolve(value));
  const normalizedParent = normalizeComparablePath(path.resolve(parent));
  return normalizedValue === normalizedParent || normalizedValue.startsWith(`${normalizedParent}${path.sep}`);
}

function normalizeComparablePath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

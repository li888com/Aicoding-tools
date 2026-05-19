import "dotenv/config";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as localStorage from "../src/local-storage.js";

type Args = {
  tokenIntervalMs: number;
  onlineIntervalMs: number;
  sinceHours: number;
  lookbackMs: number;
  tokenLimit: number;
  onlineLimit: number;
  once: boolean;
};

const execFileAsync = promisify(execFile);
const projectRoot = resolve(process.cwd());
const workerId = `${process.pid}-${Date.now()}`;
const lockDir = resolve(process.env.MCP_TOOLBOX_AUTO_SYNC_LOCK_DIR?.trim() || join(projectRoot, ".mcp-toolbox", "auto-sync.lock"));
const tsxCli = join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const args = parseArgs(process.argv.slice(2));

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

await main();

async function main(): Promise<void> {
  const acquired = await acquireLock();
  if (!acquired) {
    console.log(JSON.stringify({ ok: false, skipped: true, reason: "auto sync is already running" }, null, 2));
    return;
  }

  const startedAt = new Date().toISOString();
  await localStorage.patchAutoSyncState({
    workerId,
    status: "running",
    startedAt,
    lastHeartbeatAt: startedAt,
    lastError: null,
  });

  let lastTokenSyncAt = 0;
  let lastOnlineSyncAt = 0;

  try {
    do {
      const now = Date.now();
      await localStorage.patchAutoSyncState({
        workerId,
        status: "running",
        lastHeartbeatAt: new Date().toISOString(),
      });

      if (now - lastTokenSyncAt >= args.tokenIntervalMs) {
        await runTokenSync();
        lastTokenSyncAt = Date.now();
      }

      if (now - lastOnlineSyncAt >= args.onlineIntervalMs) {
        await runOnlineSync();
        lastOnlineSyncAt = Date.now();
      }

      if (!args.once && !stopping) {
        await sleep(Math.min(args.tokenIntervalMs, args.onlineIntervalMs, 30_000));
      }
    } while (!args.once && !stopping);

    await localStorage.patchAutoSyncState({
      workerId,
      status: "stopped",
      lastHeartbeatAt: new Date().toISOString(),
    });
  } catch (error) {
    await localStorage.patchAutoSyncState({
      workerId,
      status: "failed",
      lastHeartbeatAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await releaseLock();
  }
}

async function runTokenSync(): Promise<void> {
  const { since, source } = await computeTokenSince();
  const result = await runScript("scripts/sync-token-usage.ts", [
    "--project",
    projectRoot,
    "--since",
    since,
    "--limit",
    String(args.tokenLimit),
  ]);
  const parsed = parseJsonOutput(result.stdout);
  await localStorage.patchAutoSyncState({
    workerId,
    lastTokenSyncSince: since,
    lastTokenSyncAt: new Date().toISOString(),
    lastTokenSyncStatus: result.ok ? "ok" : "failed",
    lastTokenSyncSummary: {
      ...parsed,
      since,
      limit: args.tokenLimit,
      checkpointSource: source,
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-2000),
    },
    lastError: result.ok ? null : result.stderr || result.stdout || `token sync exited ${result.exitCode}`,
  });
}

async function computeTokenSince(): Promise<{ since: string; source: "checkpoint" | "fallback" }> {
  const fallbackMs = Date.now() - args.sinceHours * 60 * 60 * 1000;
  const state = await localStorage.getAutoSyncState();
  const checkpointMs = state?.lastTokenSyncAt ? new Date(state.lastTokenSyncAt).getTime() - args.lookbackMs : NaN;

  if (Number.isFinite(checkpointMs)) {
    return {
      since: new Date(Math.max(fallbackMs, checkpointMs)).toISOString(),
      source: "checkpoint",
    };
  }

  return {
    since: new Date(fallbackMs).toISOString(),
    source: "fallback",
  };
}

async function runOnlineSync(): Promise<void> {
  if (!process.env.SYNC_API_TOKEN?.trim()) {
    await localStorage.patchAutoSyncState({
      workerId,
      lastOnlineSyncAt: new Date().toISOString(),
      lastOnlineSyncStatus: "skipped",
      lastOnlineSyncSummary: {
        skipped: true,
        processed: 0,
        limit: args.onlineLimit,
        reason: "SYNC_API_TOKEN is not configured",
      },
      lastError: null,
    });
    return;
  }

  const result = await runScript("scripts/sync-to-online.ts", ["--limit", String(args.onlineLimit)]);
  const summary = parseOnlineSyncSummary(result.stdout);
  await localStorage.patchAutoSyncState({
    workerId,
    lastOnlineSyncAt: new Date().toISOString(),
    lastOnlineSyncStatus: result.ok ? "ok" : "failed",
    lastOnlineSyncSummary: {
      ...summary,
      limit: args.onlineLimit,
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-2000),
    },
    lastError: result.ok ? null : result.stderr || result.stdout || `online sync exited ${result.exitCode}`,
  });
}

async function runScript(scriptPath: string, scriptArgs: string[]): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, join(projectRoot, scriptPath), ...scriptArgs], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, stdout, stderr };
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      ok: false,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message,
    };
  }
}

async function acquireLock(): Promise<boolean> {
  try {
    await mkdir(lockDir, { recursive: false });
    await writeFile(join(lockDir, "worker.json"), JSON.stringify({ workerId, pid: process.pid, startedAt: new Date().toISOString() }, null, 2), "utf8");
    return true;
  } catch {
    const lockStat = await stat(lockDir).catch(() => null);
    if (lockStat && Date.now() - lockStat.mtimeMs > 10 * 60 * 1000) {
      await rm(lockDir, { recursive: true, force: true });
      return acquireLock();
    }
    return false;
  }
}

async function releaseLock(): Promise<void> {
  const ownerPath = join(lockDir, "worker.json");
  const owner = await readFile(ownerPath, "utf8").then((text) => JSON.parse(text) as { workerId?: string }).catch(() => null);
  if (!owner || owner.workerId === workerId) {
    await rm(lockDir, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    tokenIntervalMs: readNumberEnv("AUTO_SYNC_TOKEN_INTERVAL_MS", 3 * 60 * 1000),
    onlineIntervalMs: readNumberEnv("AUTO_SYNC_ONLINE_INTERVAL_MS", 10 * 60 * 1000),
    sinceHours: readNumberEnv("AUTO_SYNC_SINCE_HOURS", 24),
    lookbackMs: readNumberEnv("AUTO_SYNC_LOOKBACK_MS", 30 * 60 * 1000),
    tokenLimit: readNumberEnv("AUTO_SYNC_TOKEN_LIMIT", 200),
    onlineLimit: readNumberEnv("AUTO_SYNC_ONLINE_LIMIT", 200),
    once: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--token-interval-ms" && next) {
      parsed.tokenIntervalMs = Number(next);
      index += 1;
    } else if (arg === "--online-interval-ms" && next) {
      parsed.onlineIntervalMs = Number(next);
      index += 1;
    } else if (arg === "--since-hours" && next) {
      parsed.sinceHours = Number(next);
      index += 1;
    } else if (arg === "--lookback-ms" && next) {
      parsed.lookbackMs = Number(next);
      index += 1;
    } else if (arg === "--token-limit" && next) {
      parsed.tokenLimit = Number(next);
      index += 1;
    } else if (arg === "--online-limit" && next) {
      parsed.onlineLimit = Number(next);
      index += 1;
    } else if (arg === "--once") {
      parsed.once = true;
    }
  }

  if (!Number.isSafeInteger(parsed.tokenLimit) || parsed.tokenLimit <= 0) {
    throw new Error("--token-limit must be a positive integer");
  }
  if (!Number.isSafeInteger(parsed.onlineLimit) || parsed.onlineLimit <= 0) {
    throw new Error("--online-limit must be a positive integer");
  }

  return parsed;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseJsonOutput(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { raw: trimmed.slice(-4000) };
  }
}

function parseOnlineSyncSummary(value: string): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const line of value.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z]+):\s*(.+)$/u);
    if (!match) continue;
    const number = Number(match[2]);
    summary[match[1]] = Number.isFinite(number) ? number : match[2];
  }
  return summary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

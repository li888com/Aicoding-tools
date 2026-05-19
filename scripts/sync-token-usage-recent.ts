import "dotenv/config";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const args = parseArgs(process.argv.slice(2));
const since = new Date(Date.now() - args.hours * 60 * 60 * 1000).toISOString();

const scriptArgs = [
  tsxCli,
  path.join(projectRoot, "scripts", "sync-token-usage.ts"),
  "--project",
  args.project,
  "--since",
  since,
  "--limit",
  String(args.limit),
  ...args.extraArgs,
];

const { stdout, stderr } = await execFileAsync(process.execPath, scriptArgs, {
  cwd: projectRoot,
  env: process.env,
  maxBuffer: 20 * 1024 * 1024,
});

if (stderr) {
  process.stderr.write(stderr);
}
process.stdout.write(stdout);

function parseArgs(argv: string[]): { project: string; hours: number; limit: number; extraArgs: string[] } {
  const parsed = {
    project: path.resolve(process.env.TOKEN_SYNC_PROJECT?.trim() || projectRoot),
    hours: readNumberEnv("TOKEN_SYNC_RECENT_HOURS", 24),
    limit: readNumberEnv("TOKEN_SYNC_LIMIT", 200),
    extraArgs: [] as string[],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--project" && next) {
      parsed.project = path.resolve(next);
      index += 1;
    } else if (arg === "--hours" && next) {
      parsed.hours = Number(next);
      index += 1;
    } else if (arg === "--limit" && next) {
      parsed.limit = Number(next);
      index += 1;
    } else {
      parsed.extraArgs.push(arg);
    }
  }

  if (!Number.isFinite(parsed.hours) || parsed.hours <= 0) {
    throw new Error("--hours must be a positive number");
  }
  if (!Number.isSafeInteger(parsed.limit) || parsed.limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  return parsed;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

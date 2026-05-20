import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(join(tmpdir(), "mcp-code-stats-snapshot-"));
const snapshotPath = join(tempDir, "snapshot.json");
const testFile = "tmp-code-stats-snapshot-check.md";

try {
  const snapshot = await runCodeStats(["--snapshot"]);
  await writeFile(snapshotPath, snapshot, "utf8");
  await writeFile(testFile, ["one", "two", "three"].join("\n"), "utf8");

  const stdout = await runCodeStats(["--since-snapshot", snapshotPath, "--metadata", "--files"]);
  const payload = JSON.parse(stdout) as {
    filesChanged?: number;
    linesAdded?: number;
    linesDeleted?: number;
    codeLinesChanged?: number;
    metadata?: { codeStatsPrecision?: string };
    files?: Array<{ path: string; linesAdded: number; linesDeleted: number }>;
  };

  if (payload.metadata?.codeStatsPrecision !== "snapshot-diff") {
    throw new Error(`Expected snapshot-diff precision: ${stdout}`);
  }
  if (payload.filesChanged !== 1 || payload.linesAdded !== 3 || payload.linesDeleted !== 0 || payload.codeLinesChanged !== 3) {
    throw new Error(`Unexpected snapshot stats: ${stdout}`);
  }
  if (payload.files?.[0]?.path !== testFile) {
    throw new Error(`Unexpected snapshot file list: ${stdout}`);
  }

  console.log(JSON.stringify({
    ok: true,
    filesChanged: payload.filesChanged,
    linesAdded: payload.linesAdded,
    codeLinesChanged: payload.codeLinesChanged,
    precision: payload.metadata.codeStatsPrecision,
  }, null, 2));
} finally {
  await rm(testFile, { force: true });
  await rm(tempDir, { recursive: true, force: true });
}

async function runCodeStats(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs",
    "scripts/code-change-stats.ts",
    ...args,
  ], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

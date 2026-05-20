import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const { stdout } = await execFileAsync(process.execPath, [
  "node_modules/tsx/dist/cli.mjs",
  "scripts/code-change-stats.ts",
  "--metadata",
], {
  cwd: process.cwd(),
  maxBuffer: 20 * 1024 * 1024,
});

const payload = JSON.parse(stdout) as {
  ok?: boolean;
  filesChanged?: number;
  codeLinesChanged?: number;
  metadata?: {
    codeStatsPrecision?: string;
    trackedDiffNumstat?: string;
    trackedFiles?: unknown[];
    untrackedFiles?: unknown[];
    includesUntracked?: boolean;
    fileCategoryStats?: Record<string, unknown>;
    fileCategorySummary?: Record<string, unknown>;
    fileCategoryFiles?: unknown[];
  };
};

if (payload.ok !== true) {
  throw new Error(`Expected ok=true, got ${stdout}`);
}
if (!payload.metadata?.fileCategoryStats || !payload.metadata.fileCategorySummary) {
  throw new Error(`Missing metadata category stats: ${stdout}`);
}
if (payload.metadata.codeStatsPrecision !== "workspace-cumulative") {
  throw new Error(`Unexpected codeStatsPrecision: ${stdout}`);
}
if (typeof payload.metadata.trackedDiffNumstat !== "string") {
  throw new Error(`Missing trackedDiffNumstat: ${stdout}`);
}
if (!Array.isArray(payload.metadata.trackedFiles)) {
  throw new Error(`Missing trackedFiles: ${stdout}`);
}
if (!Array.isArray(payload.metadata.untrackedFiles)) {
  throw new Error(`Missing untrackedFiles: ${stdout}`);
}
if (payload.metadata.includesUntracked !== true) {
  throw new Error(`Expected includesUntracked=true: ${stdout}`);
}
for (const key of [
  "sourceLinesChanged",
  "docLinesChanged",
  "configLinesChanged",
  "testLinesChanged",
  "generatedLinesChanged",
  "otherLinesChanged",
]) {
  if (typeof payload.metadata.fileCategorySummary[key] !== "number") {
    throw new Error(`Missing numeric ${key}: ${stdout}`);
  }
}
if (!Array.isArray(payload.metadata.fileCategoryFiles)) {
  throw new Error(`Missing fileCategoryFiles: ${stdout}`);
}

console.log(JSON.stringify({
  ok: true,
  filesChanged: payload.filesChanged,
  codeLinesChanged: payload.codeLinesChanged,
  summary: payload.metadata.fileCategorySummary,
}, null, 2));

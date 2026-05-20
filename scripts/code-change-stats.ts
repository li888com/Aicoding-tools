import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

type FileCategory = "source" | "doc" | "config" | "test" | "generated" | "other";

type CategoryStats = {
  files: number;
  linesAdded: number;
  linesDeleted: number;
  codeLinesChanged: number;
};

type FileStat = {
  path: string;
  category: FileCategory;
  linesAdded: number;
  linesDeleted: number;
  codeLinesChanged: number;
};

type FileSnapshot = {
  path: string;
  exists: boolean;
  text: boolean;
  lines: number;
};

type Snapshot = {
  version: 1;
  createdAt: string;
  files: FileSnapshot[];
};

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
if (args.snapshot) {
  console.log(JSON.stringify(await createSnapshot(), null, 2));
  process.exit(0);
}

if (args.sinceSnapshot) {
  const snapshot = JSON.parse(await readFile(args.sinceSnapshot, "utf8")) as Snapshot;
  const files = await getStatsSinceSnapshot(snapshot);
  printStats(files, [], [], "", "snapshot-diff");
  process.exit(0);
}

const { stdout } = await execFileAsync("git", ["-c", "core.quotePath=false", "diff", "--numstat", ...args.gitArgs], {
  cwd: process.cwd(),
  maxBuffer: 20 * 1024 * 1024,
});

const trackedFiles = parseNumstat(stdout);
const untrackedFiles = args.includeUntracked ? await getUntrackedFileStats() : [];
const files = [...trackedFiles, ...untrackedFiles];
printStats(files, trackedFiles, untrackedFiles, stdout, "workspace-cumulative");

function printStats(
  files: FileStat[],
  trackedFiles: FileStat[],
  untrackedFiles: FileStat[],
  trackedDiffNumstat: string,
  precision: "workspace-cumulative" | "snapshot-diff"
) {
const categories = summarize(files);
const output = {
  ok: true,
  filesChanged: files.length,
  linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
  linesDeleted: files.reduce((sum, file) => sum + file.linesDeleted, 0),
  codeLinesChanged: files.reduce((sum, file) => sum + file.codeLinesChanged, 0),
    ...(args.metadata ? { metadata: toMetadata(categories, files, trackedFiles, untrackedFiles, trackedDiffNumstat, precision) } : { categories }),
  files: args.includeFiles ? files : undefined,
};

console.log(JSON.stringify(output, null, 2));
}

function parseNumstat(value: string): FileStat[] {
  return value
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      const linesAdded = parseNumstatNumber(addedRaw);
      const linesDeleted = parseNumstatNumber(deletedRaw);
      return {
        path: filePath,
        category: classifyPath(filePath),
        linesAdded,
        linesDeleted,
        codeLinesChanged: linesAdded + linesDeleted,
      };
    });
}

function parseNumstatNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function createSnapshot(): Promise<Snapshot> {
  const paths = await listWorkspaceFiles();
  const files: FileSnapshot[] = [];
  for (const filePath of paths) {
    const lineCount = await countTextLines(filePath);
    files.push({
      path: filePath,
      exists: true,
      text: lineCount !== null,
      lines: lineCount ?? 0,
    });
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    files,
  };
}

async function getStatsSinceSnapshot(snapshot: Snapshot): Promise<FileStat[]> {
  const before = new Map(snapshot.files.map((file) => [file.path, file]));
  const currentPaths = await listWorkspaceFiles();
  const allPaths = new Set([...before.keys(), ...currentPaths]);
  const stats: FileStat[] = [];

  for (const filePath of Array.from(allPaths).sort()) {
    const previous = before.get(filePath);
    const currentLineCount = await countTextLines(filePath);
    const currentExists = currentLineCount !== null;
    const previousLines = previous?.exists && previous.text ? previous.lines : 0;
    const currentLines = currentExists ? currentLineCount : 0;
    const delta = currentLines - previousLines;

    if (!previous && currentExists) {
      stats.push(toFileStat(filePath, currentLines, 0));
    } else if (previous && !currentExists) {
      stats.push(toFileStat(filePath, 0, previousLines));
    } else if (delta > 0) {
      stats.push(toFileStat(filePath, delta, 0));
    } else if (delta < 0) {
      stats.push(toFileStat(filePath, 0, Math.abs(delta)));
    }
  }

  return stats;
}

async function listWorkspaceFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", [
    "-c",
    "core.quotePath=false",
    "ls-files",
    "--cached",
    "--modified",
    "--others",
    "--exclude-standard",
  ], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });

  return Array.from(new Set(stdout.split(/\r?\n/u).filter(Boolean))).sort();
}

function toFileStat(filePath: string, linesAdded: number, linesDeleted: number): FileStat {
  return {
    path: filePath,
    category: classifyPath(filePath),
    linesAdded,
    linesDeleted,
    codeLinesChanged: linesAdded + linesDeleted,
  };
}

async function getUntrackedFileStats(): Promise<FileStat[]> {
  const { stdout } = await execFileAsync("git", ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });

  const files = stdout.split(/\r?\n/u).filter(Boolean);
  const stats: FileStat[] = [];
  for (const filePath of files) {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const lineCount = await countTextLines(filePath);
    if (lineCount === null) continue;
    stats.push({
      path: filePath,
      category: classifyPath(filePath),
      linesAdded: lineCount,
      linesDeleted: 0,
      codeLinesChanged: lineCount,
    });
  }
  return stats;
}

async function countTextLines(filePath: string): Promise<number | null> {
  const buffer = await readFile(filePath).catch(() => null);
  if (!buffer) return null;
  if (buffer.includes(0)) return null;
  const content = buffer.toString("utf8");
  if (content.length === 0) return 0;
  const newlineCount = content.match(/\n/gu)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function summarize(files: FileStat[]): Record<FileCategory, CategoryStats> {
  const empty = (): CategoryStats => ({ files: 0, linesAdded: 0, linesDeleted: 0, codeLinesChanged: 0 });
  const result: Record<FileCategory, CategoryStats> = {
    source: empty(),
    doc: empty(),
    config: empty(),
    test: empty(),
    generated: empty(),
    other: empty(),
  };

  for (const file of files) {
    const entry = result[file.category];
    entry.files += 1;
    entry.linesAdded += file.linesAdded;
    entry.linesDeleted += file.linesDeleted;
    entry.codeLinesChanged += file.codeLinesChanged;
  }

  return result;
}

function toMetadata(
  categories: Record<FileCategory, CategoryStats>,
  files: FileStat[],
  trackedFiles: FileStat[],
  untrackedFiles: FileStat[],
  trackedDiffNumstat: string,
  precision: "workspace-cumulative" | "snapshot-diff"
) {
  return {
    codeStatsSource: "git diff --numstat + git ls-files --others --exclude-standard + file category classifier",
    codeStatsPrecision: precision,
    trackedDiffNumstat: trackedDiffNumstat.trimEnd(),
    trackedFiles: trackedFiles.map(toMetadataFile),
    untrackedFiles: untrackedFiles.map(toMetadataFile),
    includesUntracked: true,
    fileCategoryStats: categories,
    fileCategorySummary: {
      sourceLinesChanged: categories.source.codeLinesChanged,
      docLinesChanged: categories.doc.codeLinesChanged,
      configLinesChanged: categories.config.codeLinesChanged,
      testLinesChanged: categories.test.codeLinesChanged,
      generatedLinesChanged: categories.generated.codeLinesChanged,
      otherLinesChanged: categories.other.codeLinesChanged,
    },
    fileCategoryFiles: files.map(toMetadataFile),
  };
}

function toMetadataFile(file: FileStat) {
  return {
    path: file.path,
    category: file.category,
    linesAdded: file.linesAdded,
    linesDeleted: file.linesDeleted,
    codeLinesChanged: file.codeLinesChanged,
  };
}

function classifyPath(filePath: string): FileCategory {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").pop() ?? normalized;

  if (
    normalized.includes("/dist/") ||
    normalized.includes("/build/") ||
    normalized.includes("/coverage/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/.next/") ||
    name.endsWith(".min.js") ||
    name.endsWith(".map") ||
    name === "package-lock.json" ||
    name === "pnpm-lock.yaml" ||
    name === "yarn.lock"
  ) {
    return "generated";
  }

  if (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/spec/") ||
    name.includes(".test.") ||
    name.includes(".spec.") ||
    name.startsWith("verify-")
  ) {
    return "test";
  }

  if (/\.(md|mdx|txt|rst|adoc)$/u.test(name) || normalized.startsWith("docs/")) {
    return "doc";
  }

  if (
    /\.(json|ya?ml|toml|ini|env|config|lock)$/u.test(name) ||
    name.startsWith(".") ||
    name === "dockerfile" ||
    name.endsWith("config.js") ||
    name.endsWith("config.ts")
  ) {
    return "config";
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|sql|py|java|go|rs|cs|cpp|c|h|php|rb|sh|ps1)$/u.test(name)) {
    return "source";
  }

  return "other";
}

function parseArgs(argv: string[]): {
  includeFiles: boolean;
  includeUntracked: boolean;
  metadata: boolean;
  snapshot: boolean;
  sinceSnapshot?: string;
  gitArgs: string[];
} {
  const parsed = {
    includeFiles: false,
    includeUntracked: true,
    metadata: false,
    snapshot: false,
    sinceSnapshot: undefined as string | undefined,
    gitArgs: [] as string[],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--files") {
      parsed.includeFiles = true;
    } else if (arg === "--no-untracked") {
      parsed.includeUntracked = false;
    } else if (arg === "--metadata") {
      parsed.metadata = true;
    } else if (arg === "--snapshot") {
      parsed.snapshot = true;
    } else if (arg === "--since-snapshot") {
      parsed.sinceSnapshot = argv[index + 1];
      if (!parsed.sinceSnapshot) {
        throw new Error("--since-snapshot requires a snapshot JSON file path");
      }
      index += 1;
    } else {
      parsed.gitArgs.push(arg);
    }
  }

  return parsed;
}

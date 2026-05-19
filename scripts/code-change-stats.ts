import { execFile } from "node:child_process";
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

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const { stdout } = await execFileAsync("git", ["-c", "core.quotePath=false", "diff", "--numstat", ...args.gitArgs], {
  cwd: process.cwd(),
  maxBuffer: 20 * 1024 * 1024,
});

const files = parseNumstat(stdout);
const categories = summarize(files);
const output = {
  ok: true,
  filesChanged: files.length,
  linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
  linesDeleted: files.reduce((sum, file) => sum + file.linesDeleted, 0),
  codeLinesChanged: files.reduce((sum, file) => sum + file.codeLinesChanged, 0),
  ...(args.metadata ? { metadata: toMetadata(categories, files) } : { categories }),
  files: args.includeFiles ? files : undefined,
};

console.log(JSON.stringify(output, null, 2));

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

function toMetadata(categories: Record<FileCategory, CategoryStats>, files: FileStat[]) {
  return {
    codeStatsSource: "git diff --numstat + file category classifier",
    fileCategoryStats: categories,
    fileCategorySummary: {
      sourceLinesChanged: categories.source.codeLinesChanged,
      docLinesChanged: categories.doc.codeLinesChanged,
      configLinesChanged: categories.config.codeLinesChanged,
      testLinesChanged: categories.test.codeLinesChanged,
      generatedLinesChanged: categories.generated.codeLinesChanged,
      otherLinesChanged: categories.other.codeLinesChanged,
    },
    fileCategoryFiles: files.map((file) => ({
      path: file.path,
      category: file.category,
      codeLinesChanged: file.codeLinesChanged,
    })),
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

function parseArgs(argv: string[]): { includeFiles: boolean; metadata: boolean; gitArgs: string[] } {
  const parsed = {
    includeFiles: false,
    metadata: false,
    gitArgs: [] as string[],
  };

  for (const arg of argv) {
    if (arg === "--files") {
      parsed.includeFiles = true;
    } else if (arg === "--metadata") {
      parsed.metadata = true;
    } else {
      parsed.gitArgs.push(arg);
    }
  }

  return parsed;
}

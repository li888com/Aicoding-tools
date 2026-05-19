import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { spawn } from "node:child_process";

const tempDir = await mkdtemp(join(tmpdir(), "mcp-online-sync-"));
const storageFile = join(tempDir, "data.json");
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

const server = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => {
    raw += String(chunk);
  });
  request.on("end", () => {
    requests.push({
      url: request.url ?? "",
      body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: 0, msg: null, data: { id: 9001 }, ok: true }));
  });
});

try {
  await writeFile(storageFile, JSON.stringify({
    requirements: [],
    rounds: [{
      id: 1,
      conversationId: "online-sync-file-categories-business-case",
      requirementId: null,
      requirementSource: "empty",
      modelName: "gpt-5-codex",
      startedAt: "2026-05-19T10:00:00.000Z",
      endedAt: "2026-05-19T10:01:00.000Z",
      promptText: "implement account settings page",
      filesChanged: 3,
      linesAdded: 10,
      linesDeleted: 2,
      codeLinesChanged: 12,
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      tokenSource: "mcp_payload",
      tokenMatchQuality: "mcp_payload",
      tokenSyncedAt: "2026-05-19T10:01:00.000Z",
      tokenSyncStatus: "synced",
      tokenSyncNote: null,
      metadata: {
        client: "codex",
        fileCategorySummary: {
          sourceLinesChanged: 4,
          docLinesChanged: 2,
          configLinesChanged: 1,
          testLinesChanged: 3,
          generatedLinesChanged: 0,
          otherLinesChanged: 2
        }
      }
    }],
    roundReverts: [],
    tokenUsageEvents: []
  }, null, 2), "utf8");

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const child = spawn(process.execPath, [
    "node_modules/tsx/dist/cli.mjs",
    "scripts/sync-to-online.ts"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_TOOLBOX_STORAGE_FILE: storageFile,
      SYNC_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      SYNC_API_TOKEN: "verify-token",
      ONLINE_SYNC_LIMIT: "10"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const exitCode = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  if (exitCode !== 0) {
    throw new Error(`sync-to-online failed with ${exitCode}\n${stdout.join("")}\n${stderr.join("")}`);
  }

  const roundRequest = requests.find((item) => item.url === "/rounds");
  if (!roundRequest) {
    throw new Error(`Missing /rounds request: ${JSON.stringify(requests)}`);
  }

  for (const [key, expected] of Object.entries({
    sourceLinesChanged: 4,
    docLinesChanged: 2,
    configLinesChanged: 1,
    testLinesChanged: 3,
    generatedLinesChanged: 0,
    otherLinesChanged: 2
  })) {
    if (roundRequest.body[key] !== expected) {
      throw new Error(`Expected ${key}=${expected}, got ${JSON.stringify(roundRequest.body[key])}`);
    }
  }

  const saved = JSON.parse(await readFile(storageFile, "utf8")) as { rounds?: Array<{ _sync?: { status?: string } }> };
  if (saved.rounds?.[0]?._sync?.status !== "synced") {
    throw new Error(`Round was not marked synced: ${JSON.stringify(saved.rounds?.[0])}`);
  }

  console.log(JSON.stringify({
    ok: true,
    roundsRequest: roundRequest.body
  }, null, 2));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tempDir, { recursive: true, force: true });
}

import "dotenv/config";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type SyncStatus = "pending" | "synced" | "skipped" | "failed";

type SyncState = {
  status: SyncStatus;
  onlineId?: number;
  syncedAt?: string;
  error?: string;
};

type Requirement = {
  requirementId: number;
  title: string | null;
  projectName: string | null;
  gpmNumber: string | null;
  status: "active" | "done" | "archived";
  description: string | null;
};

type Round = {
  id: number;
  conversationId: string;
  requirementId: number | null;
  requirementSource: "prompt" | "context" | "empty";
  modelName: string;
  startedAt: string;
  endedAt: string;
  promptText: string | null;
  filesChanged: number | null;
  linesAdded: number;
  linesDeleted: number;
  codeLinesChanged: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSource: string;
  tokenSyncedAt: string | null;
  tokenSyncStatus: string;
  tokenSyncNote: string | null;
  metadata: Record<string, unknown> | null;
  _sync?: SyncState;
};

type RoundRevert = {
  id: number;
  targetRoundId: number;
  conversationId: string;
  modelName: string;
  promptText: string | null;
  revertedAt: string;
  reason: string | null;
  filesChanged: number | null;
  linesAdded: number;
  linesDeleted: number;
  codeLinesChanged: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  metadata: Record<string, unknown> | null;
  _sync?: SyncState;
};

type TokenUsageEvent = {
  id: number;
  roundId: number | null;
  client: "codex" | "claude-code";
  sourcePath: string;
  sourceEventId: string | null;
  conversationId: string | null;
  turnId: string | null;
  modelName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  rawEvent: Record<string, unknown> | null;
  _sync?: SyncState;
};

type StorageData = {
  requirements?: Requirement[];
  rounds?: Round[];
  roundReverts?: RoundRevert[];
  tokenUsageEvents?: TokenUsageEvent[];
  [key: string]: unknown;
};

type ApiResponse<T> = {
  code?: number;
  msg?: string | null;
  data?: T;
};

type SyncReport = {
  requirements: number;
  rounds: number;
  roundReverts: number;
  tokenUsageEvents: number;
  skipped: number;
  failed: number;
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const storagePath = resolve(
  process.env.MCP_TOOLBOX_STORAGE_FILE?.trim() ||
    resolve(process.env.MCP_TOOLBOX_STORAGE_DIR?.trim() || ".mcp-toolbox", "data.json")
);
const baseUrl = (process.env.SYNC_API_BASE_URL || "https://ai-test.sbtjt.com/api/ai-coding").replace(/\/+$/, "");
const token = process.env.SYNC_API_TOKEN?.trim();

async function main(): Promise<void> {
  if (!dryRun && !token) {
    throw new Error("SYNC_API_TOKEN is required unless --dry-run is used.");
  }

  const data = await loadData();
  const report: SyncReport = { requirements: 0, rounds: 0, roundReverts: 0, tokenUsageEvents: 0, skipped: 0, failed: 0 };
  const idMap = buildRoundIdMap(data.rounds || []);

  await syncRequirements(data, report);
  await syncRounds(data, idMap, report);
  await syncRoundReverts(data, idMap, report);
  await syncTokenUsageEvents(data, idMap, report);

  if (!dryRun) {
    await saveData(data);
  }

  printReport(report);
}

async function loadData(): Promise<StorageData> {
  const content = await readFile(storagePath, "utf8");
  return JSON.parse(content) as StorageData;
}

async function saveData(data: StorageData): Promise<void> {
  await mkdir(dirname(storagePath), { recursive: true });
  const tempPath = `${storagePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tempPath, storagePath);
}

async function syncRequirements(data: StorageData, report: SyncReport): Promise<void> {
  for (const requirement of data.requirements || []) {
    if (!shouldUpload(requirement)) continue;
    await uploadItem(
      requirement,
      report,
      "requirements",
      async () =>
        request<unknown>(`/requirements/${requirement.requirementId}`, "PUT", {
          title: requirement.title,
          projectName: requirement.projectName,
          gpmNumber: requirement.gpmNumber,
          status: mapRequirementStatus(requirement.status),
          description: requirement.description,
        }),
      requirement.requirementId
    );
    await saveCheckpoint(data);
  }
}

async function syncRounds(data: StorageData, idMap: Map<number, number>, report: SyncReport): Promise<void> {
  const requirementsById = new Map((data.requirements || []).map((item) => [item.requirementId, item]));

  for (const round of data.rounds || []) {
    if (!shouldUpload(round)) continue;

    const requirement = round.requirementId === null ? undefined : requirementsById.get(round.requirementId);
    await uploadItem(
      round,
      report,
      "rounds",
      async () => {
        const onlineRound = await request<{ id?: number | string }>(`/rounds`, "POST", {
          idempotencyKey: `local-round-${round.id}`,
          conversationId: round.conversationId,
          startedAt: round.startedAt,
          endedAt: round.endedAt,
          modelName: round.modelName,
          promptText: round.promptText,
          requirementId: round.requirementId,
          requirementSource: round.requirementSource,
          requirementTitle: requirement?.title,
          projectName: requirement?.projectName,
          gpmNumber: requirement?.gpmNumber,
          filesChanged: round.filesChanged,
          linesAdded: round.linesAdded,
          linesDeleted: round.linesDeleted,
          codeLinesChanged: round.codeLinesChanged,
          inputTokens: round.inputTokens,
          outputTokens: round.outputTokens,
          totalTokens: round.totalTokens,
          tokenSource: round.tokenSource,
          metadata: { ...(round.metadata || {}), localRoundId: round.id },
        });
        return parseOnlineId(onlineRound?.id, "round response id");
      }
    );

    if (round._sync?.onlineId) {
      idMap.set(round.id, round._sync.onlineId);
    } else if (dryRun) {
      idMap.set(round.id, round.id);
    }
    await saveCheckpoint(data);
  }
}

async function syncRoundReverts(data: StorageData, idMap: Map<number, number>, report: SyncReport): Promise<void> {
  for (const revert of data.roundReverts || []) {
    if (!shouldUpload(revert)) continue;

    const onlineTargetRoundId = idMap.get(revert.targetRoundId);
    if (!onlineTargetRoundId) {
      markFailed(revert, `Missing online id for target round ${revert.targetRoundId}`);
      report.failed += 1;
      await saveCheckpoint(data);
      continue;
    }

    await uploadItem(
      revert,
      report,
      "roundReverts",
      async () =>
        request<boolean>(`/round-reverts`, "POST", {
          conversationId: revert.conversationId,
          targetRoundId: onlineTargetRoundId,
          revertedAt: revert.revertedAt,
          modelName: revert.modelName,
          promptText: revert.promptText,
          reason: revert.reason,
          filesChanged: revert.filesChanged,
          linesAdded: revert.linesAdded,
          linesDeleted: revert.linesDeleted,
          codeLinesChanged: revert.codeLinesChanged,
          metadata: { ...(revert.metadata || {}), localRevertId: revert.id, localTargetRoundId: revert.targetRoundId },
        })
    );
    await saveCheckpoint(data);
  }
}

async function syncTokenUsageEvents(data: StorageData, idMap: Map<number, number>, report: SyncReport): Promise<void> {
  for (const event of data.tokenUsageEvents || []) {
    if (!shouldUpload(event)) continue;

    if (event.roundId === null) {
      markSkipped(event, "Token usage event has no roundId.");
      report.skipped += 1;
      await saveCheckpoint(data);
      continue;
    }

    const onlineRoundId = idMap.get(event.roundId);
    if (!onlineRoundId) {
      markFailed(event, `Missing online id for round ${event.roundId}`);
      report.failed += 1;
      await saveCheckpoint(data);
      continue;
    }

    await uploadItem(
      event,
      report,
      "tokenUsageEvents",
      async () =>
        request<boolean>(`/token-usage-events`, "POST", {
          roundId: onlineRoundId,
          client: event.client,
          sourcePath: event.sourcePath,
          sourceEventId: event.sourceEventId,
          conversationId: event.conversationId,
          turnId: event.turnId,
          modelName: event.modelName,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
          rawEvent: event.rawEvent,
        })
    );
    await saveCheckpoint(data);
  }
}

async function uploadItem<T extends { _sync?: SyncState }>(
  item: T,
  report: SyncReport,
  key: keyof SyncReport,
  upload: () => Promise<unknown>,
  onlineId?: number
): Promise<void> {
  try {
    if (dryRun) {
      report[key] += 1;
      return;
    }

    const result = await upload();
    const returnedId = typeof result === "number" ? result : onlineId;
    markSynced(item, returnedId);
    report[key] += 1;
  } catch (error) {
    markFailed(item, error instanceof Error ? error.message : String(error));
    report.failed += 1;
  }
}

async function request<T>(path: string, method: "POST" | "PUT", body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as ApiResponse<T>) : {};

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${parsed.msg || text || response.statusText}`);
  }
  if (parsed.code !== undefined && parsed.code !== 0) {
    throw new Error(parsed.msg || `API returned code ${parsed.code}`);
  }

  return parsed.data as T;
}

function buildRoundIdMap(rounds: Round[]): Map<number, number> {
  const idMap = new Map<number, number>();
  for (const round of rounds) {
    if (round._sync?.onlineId) {
      idMap.set(round.id, round._sync.onlineId);
    }
  }
  return idMap;
}

function shouldUpload(item: { _sync?: SyncState }): boolean {
  return item._sync?.status !== "synced" && item._sync?.status !== "skipped";
}

function markSynced(item: { _sync?: SyncState }, onlineId?: number): void {
  item._sync = {
    status: "synced",
    ...(onlineId !== undefined ? { onlineId } : {}),
    syncedAt: new Date().toISOString(),
  };
}

function markSkipped(item: { _sync?: SyncState }, reason: string): void {
  item._sync = { status: "skipped", error: reason };
}

function markFailed(item: { _sync?: SyncState }, error: string): void {
  item._sync = { status: "failed", error };
}

async function saveCheckpoint(data: StorageData): Promise<void> {
  if (!dryRun) {
    await saveData(data);
  }
}

function mapRequirementStatus(status: Requirement["status"]): string {
  if (status === "done") return "completed";
  return status;
}

function parseOnlineId(value: number | string | undefined, label: string): number {
  const id = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(id)) {
    throw new Error(`Missing or invalid ${label}.`);
  }
  return id;
}

function printReport(report: SyncReport): void {
  console.log(`Sync ${dryRun ? "dry run" : "completed"} for ${storagePath}`);
  console.log(`API base: ${baseUrl}`);
  console.log(`requirements: ${report.requirements}`);
  console.log(`rounds: ${report.rounds}`);
  console.log(`roundReverts: ${report.roundReverts}`);
  console.log(`tokenUsageEvents: ${report.tokenUsageEvents}`);
  console.log(`skipped: ${report.skipped}`);
  console.log(`failed: ${report.failed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

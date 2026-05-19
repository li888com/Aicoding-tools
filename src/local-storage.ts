import { readFile, writeFile, mkdir, rmdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const LEGACY_STORAGE_DIR = join(homedir(), ".mcp-toolbox");
const DEFAULT_STORAGE_DIR = resolve(process.env.MCP_TOOLBOX_STORAGE_DIR?.trim() || join(process.cwd(), ".mcp-toolbox"));
const STORAGE_FILE = "data.json";
const LOCK_DIR = ".lock";
const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_RETRY_MS = 50;

type Conversation = {
  conversationId: string;
  currentRequirementId: number | null;
  lastRoundId: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Requirement = {
  requirementId: number;
  title: string | null;
  projectName: string | null;
  gpmNumber: string | null;
  status: "active" | "done" | "archived";
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type SyncStatus = "pending" | "synced" | "skipped" | "failed";

type SyncState = {
  status: SyncStatus;
  onlineId?: number;
  syncedAt?: string;
  error?: string;
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
  createdAt: string;
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
  createdAt: string;
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
  createdAt: string;
  _sync?: SyncState;
};

type StorageData = {
  conversations: Conversation[];
  requirements: Requirement[];
  rounds: Round[];
  roundReverts: RoundRevert[];
  tokenUsageEvents: TokenUsageEvent[];
  nextRoundId: number;
  nextRoundRevertId: number;
  nextTokenUsageEventId: number;
};

let storageDir = DEFAULT_STORAGE_DIR;
let cachedData: StorageData | null = null;
let lastModified: number = 0;

export function setStorageDir(dir: string) {
  storageDir = dir;
  cachedData = null;
}

function getStoragePath(): string {
  return join(storageDir, STORAGE_FILE);
}

async function ensureStorageDir(): Promise<void> {
  try {
    await mkdir(storageDir, { recursive: true });
  } catch {
    // Directory already exists or error will be thrown when writing
  }
}

async function withStorageLock<T>(action: () => Promise<T>): Promise<T> {
  await ensureStorageDir();
  const lockPath = join(storageDir, LOCK_DIR);

  // Acquire lock via atomic mkdir.
  // This is intentionally simple: it's meant to avoid concurrent writes corrupting JSON.
  // If the lock is stale, it is removed and acquisition retried.
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "EEXIST") {
        throw error;
      }

      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await rmdir(lockPath).catch(() => undefined);
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS + Math.floor(Math.random() * LOCK_RETRY_MS)));
    }
  }

  try {
    return await action();
  } finally {
    await rmdir(lockPath).catch(() => undefined);
  }
}

async function loadData(forceReload = false): Promise<StorageData> {
  const storagePath = getStoragePath();

  try {
    const stats = await stat(storagePath);
    if (!forceReload && cachedData && stats.mtimeMs === lastModified) {
      return cachedData;
    }

    const content = await readFile(storagePath, "utf8");
    cachedData = JSON.parse(content) as StorageData;
    lastModified = stats.mtimeMs;
    return cachedData;
  } catch {
    // Migrate from legacy path if present.
    const legacyPath = join(LEGACY_STORAGE_DIR, STORAGE_FILE);
    if (storagePath !== legacyPath) {
      try {
        const legacyContent = await readFile(legacyPath, "utf8");
        const migrated = JSON.parse(legacyContent) as StorageData;
        await saveData(migrated);
        return migrated;
      } catch {
        // ignore migration failures, fall back to empty data
      }
    }

    // File doesn't exist, return empty data
    const emptyData: StorageData = {
      conversations: [],
      requirements: [],
      rounds: [],
      roundReverts: [],
      tokenUsageEvents: [],
      nextRoundId: 1,
      nextRoundRevertId: 1,
      nextTokenUsageEventId: 1,
    };
    await saveData(emptyData);
    return emptyData;
  }
}

async function saveData(data: StorageData): Promise<void> {
  await ensureStorageDir();
  const storagePath = getStoragePath();
  const content = JSON.stringify(data, null, 2);
  await writeFile(storagePath, content, "utf8");
  cachedData = data;
  const stats = await stat(storagePath);
  lastModified = stats.mtimeMs;
}

export type { Conversation, Requirement, Round, RoundRevert, SyncState, SyncStatus, TokenUsageEvent, StorageData };

export async function getConversations(): Promise<Conversation[]> {
  const data = await loadData();
  return data.conversations;
}

export async function getConversation(conversationId: string): Promise<Conversation | undefined> {
  const data = await loadData();
  return data.conversations.find((c) => c.conversationId === conversationId);
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.conversations.findIndex((c) => c.conversationId === conversation.conversationId);
    if (index >= 0) {
      data.conversations[index] = conversation;
    } else {
      data.conversations.push(conversation);
    }
    await saveData(data);
  });
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.conversations.findIndex((c) => c.conversationId === conversationId);
    if (index >= 0) {
      data.conversations.splice(index, 1);
      await saveData(data);
      return true;
    }
    return false;
  });
}

export async function getRequirements(): Promise<Requirement[]> {
  const data = await loadData();
  return data.requirements;
}

export async function getRequirement(requirementId: number): Promise<Requirement | undefined> {
  const data = await loadData();
  return data.requirements.find((r) => r.requirementId === requirementId);
}

export async function saveRequirement(requirement: Requirement): Promise<void> {
  await withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.requirements.findIndex((r) => r.requirementId === requirement.requirementId);
    if (index >= 0) {
      data.requirements[index] = requirement;
    } else {
      data.requirements.push(requirement);
    }
    await saveData(data);
  });
}

export async function deleteRequirement(requirementId: number): Promise<boolean> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.requirements.findIndex((r) => r.requirementId === requirementId);
    if (index >= 0) {
      data.requirements.splice(index, 1);
      await saveData(data);
      return true;
    }
    return false;
  });
}

export async function getRounds(): Promise<Round[]> {
  const data = await loadData();
  return data.rounds;
}

export async function getRound(id: number): Promise<Round | undefined> {
  const data = await loadData();
  return data.rounds.find((r) => r.id === id);
}

export async function getRoundsByConversation(conversationId: string): Promise<Round[]> {
  const data = await loadData();
  return data.rounds.filter((r) => r.conversationId === conversationId);
}

export async function createRound(round: Omit<Round, "id" | "createdAt">): Promise<Round> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const id = data.nextRoundId++;
    const createdAt = new Date().toISOString();
    const newRound: Round = { ...round, id, createdAt };
    data.rounds.push(newRound);
    await saveData(data);
    return newRound;
  });
}

export async function updateRound(round: Round): Promise<void> {
  await withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.rounds.findIndex((r) => r.id === round.id);
    if (index >= 0) {
      data.rounds[index] = round;
      await saveData(data);
      return;
    }
    throw new Error(`Round ${round.id} not found`);
  });
}

export async function deleteRound(id: number): Promise<boolean> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.rounds.findIndex((r) => r.id === id);
    if (index >= 0) {
      data.rounds.splice(index, 1);
      await saveData(data);
      return true;
    }
    return false;
  });
}

export async function getRoundReverts(): Promise<RoundRevert[]> {
  const data = await loadData();
  return data.roundReverts;
}

export async function getRoundRevertByTarget(targetRoundId: number): Promise<RoundRevert | undefined> {
  const data = await loadData();
  return data.roundReverts.find((rr) => rr.targetRoundId === targetRoundId);
}

export async function createRoundRevert(revert: Omit<RoundRevert, "id" | "createdAt">): Promise<RoundRevert> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const id = data.nextRoundRevertId++;
    const createdAt = new Date().toISOString();
    const newRevert: RoundRevert = { ...revert, id, createdAt };
    data.roundReverts.push(newRevert);
    await saveData(data);
    return newRevert;
  });
}

export async function deleteRoundRevertByTarget(targetRoundId: number): Promise<boolean> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const index = data.roundReverts.findIndex((revert) => revert.targetRoundId === targetRoundId);
    if (index >= 0) {
      data.roundReverts.splice(index, 1);
      await saveData(data);
      return true;
    }
    return false;
  });
}

export async function getTokenUsageEvents(): Promise<TokenUsageEvent[]> {
  const data = await loadData();
  return data.tokenUsageEvents;
}

export async function createTokenUsageEvent(event: Omit<TokenUsageEvent, "id" | "createdAt">): Promise<TokenUsageEvent> {
  return withStorageLock(async () => {
    const data = await loadData(true);
    const id = data.nextTokenUsageEventId++;
    const createdAt = new Date().toISOString();
    const newEvent: TokenUsageEvent = { ...event, id, createdAt };
    data.tokenUsageEvents.push(newEvent);
    await saveData(data);
    return newEvent;
  });
}

export async function clearAllData(): Promise<void> {
  await withStorageLock(async () => {
    const emptyData: StorageData = {
      conversations: [],
      requirements: [],
      rounds: [],
      roundReverts: [],
      tokenUsageEvents: [],
      nextRoundId: 1,
      nextRoundRevertId: 1,
      nextTokenUsageEventId: 1,
    };
    await saveData(emptyData);
  });
}

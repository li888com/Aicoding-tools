import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardConfig, getDashboardConfig } from "./dashboard-config.js";
import * as localStorage from "./local-storage.js";

type FilterOptions = {
  from?: string;
  to?: string;
  model?: string;
  requirementId?: string;
  client?: string;
  includeReverted: boolean;
};

type RequirementRecordInput = {
  title?: string | null;
  projectName?: string | null;
  gpmNumber?: string | null;
  status?: string | null;
  description?: string | null;
};

type RoundRecordInput = {
  requirementId?: string | number | null;
  modelName?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  promptText?: string | null;
  client?: string | null;
  filesChanged?: string | number | null;
  linesAdded?: string | number | null;
  linesDeleted?: string | number | null;
  codeLinesChanged?: string | number | null;
  inputTokens?: string | number | null;
  outputTokens?: string | number | null;
  totalTokens?: string | number | null;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(moduleDir, "..", "public", "dashboard");
const cookieName = "ai_coding_dashboard_session";

const maxLogFilesReturned = 200;
const maxLogFilesScanned = 3000;
const maxLogTailBytes = 256 * 1024;
const defaultLogTailBytes = 64 * 1024;

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function createDashboardServer(config: DashboardConfig = getDashboardConfig()) {
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, config);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: DashboardConfig
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/login") {
    await sendStatic(response, "login.html");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    await handleLogin(request, response, config);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return;
  }

  const authenticated = isAuthenticated(request, config);

  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, authenticated ? 200 : 401, { authenticated });
    return;
  }

  if (!authenticated) {
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    redirect(response, "/login");
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    await sendStatic(response, "index.html");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, url, response);
    return;
  }

  if (request.method === "GET") {
    const relativePath = url.pathname.replace(/^\/+/, "");
    await sendStatic(response, relativePath || "index.html");
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
}

async function handleApi(request: IncomingMessage, url: URL, response: ServerResponse): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/filters") {
    sendJson(response, 200, await getFilters());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/requirement-records") {
    sendJson(response, 200, await getRequirementRecords());
    return;
  }

  const requirementMatch = url.pathname.match(/^\/api\/requirement-records\/([1-9]\d*)$/);
  if (requirementMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await upsertRequirementRecord(Number(requirementMatch[1]), body));
    return;
  }

  if (requirementMatch && request.method === "DELETE") {
    sendJson(response, 200, await deleteRequirementRecord(Number(requirementMatch[1])));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/local-logs/files") {
    sendJson(response, 200, await listLocalLogFiles(url.searchParams));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/local-logs/file") {
    sendJson(response, 200, await readLocalLogFile(url.searchParams));
    return;
  }

  const filters = parseFilters(url.searchParams);

  if (request.method === "GET" && url.pathname === "/api/summary") {
    sendJson(response, 200, await getSummary(filters));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/requirements") {
    sendJson(response, 200, await getRequirements(filters));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/models") {
    sendJson(response, 200, await getModels(filters));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/timeline") {
    sendJson(response, 200, await getTimeline(filters));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rounds") {
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 200);
    sendJson(response, 200, await getRounds(filters, limit));
    return;
  }

  const roundMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)$/);
  if (roundMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await updateRoundRecord(Number(roundMatch[1]), body));
    return;
  }

  if (roundMatch && request.method === "DELETE") {
    sendJson(response, 200, await deleteRoundRecord(Number(roundMatch[1])));
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

function parseFilters(searchParams: URLSearchParams): FilterOptions {
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    model: searchParams.get("model") || undefined,
    requirementId: searchParams.get("requirementId") || undefined,
    client: searchParams.get("client") || undefined,
    includeReverted: searchParams.get("includeReverted") === "true",
  };
}

function getRoundClient(round: localStorage.Round): string | null {
  if (!round.metadata || typeof round.metadata !== "object") return null;
  const client = (round.metadata as Record<string, unknown>).client;
  return typeof client === "string" && client.trim() ? client.trim() : null;
}

function parseDateFilter(value: string | undefined, boundary: "start" | "end"): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateLike = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed);
  const parsed = dateLike
    ? new Date(`${trimmed}T${boundary === "start" ? "00:00:00.000" : "23:59:59.999"}`)
    : new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requirementLabel(requirementId: number | null, record?: localStorage.Requirement): string {
  if (requirementId === null) return "未关联需求";
  const suffix = record?.title ? ` ${record.title}` : "";
  return `#${requirementId}${suffix}`;
}

function safeDurationMs(round: localStorage.Round): number {
  const startedAt = new Date(round.startedAt).getTime();
  const endedAt = new Date(round.endedAt).getTime();
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return 0;
  }
  return endedAt - startedAt;
}

function filterRoundsBase(rounds: localStorage.Round[], filters: FilterOptions): localStorage.Round[] {
  const fromDate = parseDateFilter(filters.from, "start");
  const toDate = parseDateFilter(filters.to, "end");

  const requirementFilter =
    filters.requirementId === undefined || filters.requirementId === ""
      ? undefined
      : filters.requirementId === "null"
        ? null
        : Number(filters.requirementId);

  return rounds.filter((round) => {
    const startedAt = new Date(round.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      return false;
    }

    if (fromDate && startedAt < fromDate) {
      return false;
    }
    if (toDate && startedAt > toDate) {
      return false;
    }
    if (filters.model && round.modelName !== filters.model) {
      return false;
    }
    if (filters.client && getRoundClient(round) !== filters.client) {
      return false;
    }
    if (filters.requirementId) {
      if (requirementFilter === null) {
        if (round.requirementId !== null) return false;
      } else if (typeof requirementFilter === "number" && Number.isFinite(requirementFilter)) {
        if (round.requirementId !== requirementFilter) return false;
      }
    }
    return true;
  });
}

function filterEffectiveRounds(rounds: localStorage.Round[], reverts: localStorage.RoundRevert[], filters: FilterOptions) {
  const base = filterRoundsBase(rounds, filters);
  const revertedRoundIds = new Set(reverts.map((revert) => revert.targetRoundId));
  const effective = filters.includeReverted ? base : base.filter((round) => !revertedRoundIds.has(round.id));
  return { base, effective, revertedRoundIds };
}

async function getSummary(filters: FilterOptions) {
  const [rounds, reverts] = await Promise.all([localStorage.getRounds(), localStorage.getRoundReverts()]);
  const { base, effective, revertedRoundIds } = filterEffectiveRounds(rounds, reverts, filters);

  let totalTokens = 0;
  let codeLinesChanged = 0;
  let unlinkedRounds = 0;
  let tokenMissingRounds = 0;
  let tokenSyncedRounds = 0;
  let claudeTokenRounds = 0;
  let codexTokenRounds = 0;
  let tokenSyncIssueRounds = 0;

  const requirementIds = new Set<number>();
  for (const round of effective) {
    totalTokens += round.totalTokens;
    codeLinesChanged += round.codeLinesChanged;
    if (round.requirementId === null) {
      unlinkedRounds++;
    } else {
      requirementIds.add(round.requirementId);
    }

    if (round.totalTokens <= 0) {
      tokenMissingRounds++;
    }
    if (round.tokenSyncStatus === "synced") {
      tokenSyncedRounds++;
    }
    if (round.tokenSource === "claude_jsonl") {
      claudeTokenRounds++;
    }
    if (round.tokenSource === "codex_log") {
      codexTokenRounds++;
    }
    if (
      round.tokenSyncStatus === "not_found" ||
      round.tokenSyncStatus === "ambiguous" ||
      round.tokenSyncStatus === "failed"
    ) {
      tokenSyncIssueRounds++;
    }
  }

  const revertedRounds = base.reduce((count, round) => count + (revertedRoundIds.has(round.id) ? 1 : 0), 0);
  const codeLinesPerKTokens = totalTokens > 0 ? (codeLinesChanged / totalTokens) * 1000 : null;
  const tokensPerCodeLine = codeLinesChanged > 0 ? totalTokens / codeLinesChanged : null;

  return {
    requirementCount: requirementIds.size,
    roundCount: effective.length,
    revertedRounds,
    unlinkedRounds,
    totalTokens,
    tokenMissingRounds,
    codeLinesChanged,
    codeLinesPerKTokens,
    tokensPerCodeLine,
    tokenSyncedRounds,
    claudeTokenRounds,
    codexTokenRounds,
    tokenSyncIssueRounds,
  };
}

async function getRequirements(filters: FilterOptions) {
  const [rounds, reverts, requirementRecords] = await Promise.all([
    localStorage.getRounds(),
    localStorage.getRoundReverts(),
    localStorage.getRequirements(),
  ]);
  const recordMap = new Map(requirementRecords.map((record) => [record.requirementId, record]));
  const { effective } = filterEffectiveRounds(rounds, reverts, filters);

  const groups = new Map<
    number | null,
    {
      requirementId: number | null;
      requirementLabel: string;
      title: string | null;
      projectName: string | null;
      gpmNumber: string | null;
      roundCount: number;
      durationMs: number;
      firstStartedAt: string | null;
      lastEndedAt: string | null;
      codeLinesChanged: number;
      totalTokens: number;
      codeLinesPerKTokens: number | null;
    }
  >();

  for (const round of effective) {
    const reqId = round.requirementId;
    const record = reqId === null ? undefined : recordMap.get(reqId);
    let group = groups.get(reqId);
    if (!group) {
      group = {
        requirementId: reqId,
        requirementLabel: requirementLabel(reqId, record),
        title: record?.title ?? null,
        projectName: record?.projectName ?? null,
        gpmNumber: record?.gpmNumber ?? null,
        roundCount: 0,
        durationMs: 0,
        firstStartedAt: null,
        lastEndedAt: null,
        codeLinesChanged: 0,
        totalTokens: 0,
        codeLinesPerKTokens: null,
      };
      groups.set(reqId, group);
    }

    group.roundCount++;
    group.durationMs += safeDurationMs(round);
    group.codeLinesChanged += round.codeLinesChanged;
    group.totalTokens += round.totalTokens;

    if (!group.firstStartedAt || new Date(round.startedAt) < new Date(group.firstStartedAt)) {
      group.firstStartedAt = round.startedAt;
    }
    if (!group.lastEndedAt || new Date(round.endedAt) > new Date(group.lastEndedAt)) {
      group.lastEndedAt = round.endedAt;
    }
  }

  for (const group of groups.values()) {
    group.codeLinesPerKTokens = group.totalTokens > 0 ? (group.codeLinesChanged / group.totalTokens) * 1000 : null;
  }

  return Array.from(groups.values())
    .sort((a, b) => (b.codeLinesChanged - a.codeLinesChanged) || String(a.requirementId).localeCompare(String(b.requirementId)))
    .slice(0, 200);
}

async function getModels(filters: FilterOptions) {
  const [rounds, reverts] = await Promise.all([localStorage.getRounds(), localStorage.getRoundReverts()]);
  const { base, effective, revertedRoundIds } = filterEffectiveRounds(rounds, reverts, filters);

  const totalByModel = new Map<string, { totalRounds: number; revertedRounds: number }>();
  for (const round of base) {
    const entry = totalByModel.get(round.modelName) ?? { totalRounds: 0, revertedRounds: 0 };
    entry.totalRounds++;
    if (revertedRoundIds.has(round.id)) {
      entry.revertedRounds++;
    }
    totalByModel.set(round.modelName, entry);
  }

  const groups = new Map<
    string,
    {
      modelName: string;
      effectiveRounds: number;
      codeLinesChanged: number;
      totalTokens: number;
      averageDurationMs: number;
      revertRate: number;
      codeLinesPerKTokens: number | null;
    }
  >();

  for (const round of effective) {
    const entry = groups.get(round.modelName) ?? {
      modelName: round.modelName,
      effectiveRounds: 0,
      codeLinesChanged: 0,
      totalTokens: 0,
      averageDurationMs: 0,
      revertRate: 0,
      codeLinesPerKTokens: null,
    };

    entry.effectiveRounds++;
    entry.codeLinesChanged += round.codeLinesChanged;
    entry.totalTokens += round.totalTokens;
    entry.averageDurationMs += safeDurationMs(round);
    groups.set(round.modelName, entry);
  }

  for (const entry of groups.values()) {
    const total = totalByModel.get(entry.modelName)?.totalRounds ?? entry.effectiveRounds;
    const reverted = totalByModel.get(entry.modelName)?.revertedRounds ?? 0;
    entry.revertRate = total > 0 ? reverted / total : 0;
    entry.averageDurationMs = entry.effectiveRounds > 0 ? entry.averageDurationMs / entry.effectiveRounds : 0;
    entry.codeLinesPerKTokens = entry.totalTokens > 0 ? (entry.codeLinesChanged / entry.totalTokens) * 1000 : null;
  }

  return Array.from(groups.values()).sort((a, b) => (b.codeLinesPerKTokens ?? 0) - (a.codeLinesPerKTokens ?? 0));
}

async function getTimeline(filters: FilterOptions) {
  const [rounds, reverts] = await Promise.all([localStorage.getRounds(), localStorage.getRoundReverts()]);
  const { effective } = filterEffectiveRounds(rounds, reverts, filters);

  const groups = new Map<string, { day: string; roundCount: number; totalTokens: number; codeLinesChanged: number }>();
  for (const round of effective) {
    const day = round.startedAt.split("T")[0] ?? "";
    if (!day) continue;
    const entry = groups.get(day) ?? { day, roundCount: 0, totalTokens: 0, codeLinesChanged: 0 };
    entry.roundCount++;
    entry.totalTokens += round.totalTokens;
    entry.codeLinesChanged += round.codeLinesChanged;
    groups.set(day, entry);
  }

  return Array.from(groups.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-180);
}

async function getRounds(filters: FilterOptions, limit: number) {
  const [rounds, reverts, requirementRecords] = await Promise.all([
    localStorage.getRounds(),
    localStorage.getRoundReverts(),
    localStorage.getRequirements(),
  ]);
  const recordMap = new Map(requirementRecords.map((record) => [record.requirementId, record]));
  const { effective, revertedRoundIds } = filterEffectiveRounds(rounds, reverts, filters);

  effective.sort((a, b) => {
    const dateA = new Date(a.endedAt);
    const dateB = new Date(b.endedAt);
    if (dateB.getTime() !== dateA.getTime()) {
      return dateB.getTime() - dateA.getTime();
    }
    return b.id - a.id;
  });

  return effective.slice(0, limit).map((round) => {
    const record = round.requirementId === null ? undefined : recordMap.get(round.requirementId);
    return {
      id: round.id,
      conversationId: round.conversationId,
      requirementId: round.requirementId,
      requirementLabel: requirementLabel(round.requirementId, record),
      title: record?.title ?? null,
      projectName: record?.projectName ?? null,
      gpmNumber: record?.gpmNumber ?? null,
      startedAt: round.startedAt,
      endedAt: round.endedAt,
      durationMs: safeDurationMs(round),
      modelName: round.modelName,
      client: getRoundClient(round),
      filesChanged: round.filesChanged,
      linesAdded: round.linesAdded,
      linesDeleted: round.linesDeleted,
      codeLinesChanged: round.codeLinesChanged,
      inputTokens: round.inputTokens,
      outputTokens: round.outputTokens,
      totalTokens: round.totalTokens,
      tokenSource: round.tokenSource,
      tokenSyncStatus: round.tokenSyncStatus,
      tokenSyncedAt: round.tokenSyncedAt,
      tokenSyncNote: round.tokenSyncNote,
      isReverted: revertedRoundIds.has(round.id),
      promptText: round.promptText ?? "",
    };
  });
}

async function getFilters() {
  const [rounds, requirementRecords] = await Promise.all([localStorage.getRounds(), localStorage.getRequirements()]);
  const models = new Set<string>();
  const requirementIds = new Set<number>();
  const clients = new Set<string>();
  const recordMap = new Map(requirementRecords.map((record) => [record.requirementId, record]));

  for (const round of rounds) {
    models.add(round.modelName);
    if (round.requirementId !== null) {
      requirementIds.add(round.requirementId);
    }
    const client = getRoundClient(round);
    if (client) {
      clients.add(client);
    }
  }

  for (const record of requirementRecords) {
    requirementIds.add(record.requirementId);
  }

  return {
    models: Array.from(models).sort(),
    requirements: [
      { id: null as number | null, label: "未关联需求" },
      ...Array.from(requirementIds)
        .sort((a, b) => a - b)
        .map((id) => ({ id, label: requirementLabel(id, recordMap.get(id)) })),
    ],
    clients: Array.from(clients).sort(),
  };
}

function parseInteger(
  value: unknown,
  options: { allowNull?: boolean; allowUndefined?: boolean; min?: number } = {}
): number | null | undefined {
  const allowNull = options.allowNull ?? false;
  const allowUndefined = options.allowUndefined ?? true;
  const min = options.min ?? 0;

  if (value === undefined) return allowUndefined ? undefined : undefined;
  if (value === null) return allowNull ? null : undefined;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
      throw new Error("Expected a valid integer");
    }
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return allowNull ? null : undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min) {
      throw new Error("Expected a valid integer");
    }
    return parsed;
  }

  throw new Error("Expected a valid integer");
}

function parseRoundRecordInput(input: Record<string, unknown>): {
  requirementId?: number | null;
  modelName?: string;
  startedAt?: string;
  endedAt?: string;
  promptText?: string | null;
  client?: string | null;
  filesChanged?: number | null;
  linesAdded?: number;
  linesDeleted?: number;
  codeLinesChanged?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  const payload = input as RoundRecordInput;

  let requirementId: number | null | undefined;
  if (payload.requirementId !== undefined) {
    if (payload.requirementId === null) {
      requirementId = null;
    } else if (typeof payload.requirementId === "number") {
      requirementId = payload.requirementId;
    } else if (typeof payload.requirementId === "string") {
      const trimmed = payload.requirementId.trim();
      requirementId = trimmed ? Number(trimmed) : null;
    } else {
      throw new Error("Invalid requirementId");
    }

    if (requirementId !== null && (!Number.isInteger(requirementId) || requirementId <= 0)) {
      throw new Error("requirementId must be a positive integer or empty");
    }
  }

  const modelName = typeof payload.modelName === "string" ? payload.modelName : undefined;
  const startedAt = typeof payload.startedAt === "string" && payload.startedAt.trim() ? payload.startedAt : undefined;
  const endedAt = typeof payload.endedAt === "string" && payload.endedAt.trim() ? payload.endedAt : undefined;
  const promptText =
    payload.promptText === undefined ? undefined : (typeof payload.promptText === "string" ? payload.promptText : null);
  const client = payload.client === undefined ? undefined : (typeof payload.client === "string" ? payload.client : null);

  const filesChanged = parseInteger(payload.filesChanged, { allowNull: true });
  const linesAdded = parseInteger(payload.linesAdded);
  const linesDeleted = parseInteger(payload.linesDeleted);
  const codeLinesChanged = parseInteger(payload.codeLinesChanged);
  const inputTokens = parseInteger(payload.inputTokens);
  const outputTokens = parseInteger(payload.outputTokens);
  const totalTokens = parseInteger(payload.totalTokens);

  return {
    requirementId,
    modelName,
    startedAt,
    endedAt,
    promptText,
    client,
    filesChanged: filesChanged === undefined ? undefined : filesChanged,
    linesAdded: linesAdded === undefined || linesAdded === null ? undefined : linesAdded,
    linesDeleted: linesDeleted === undefined || linesDeleted === null ? undefined : linesDeleted,
    codeLinesChanged: codeLinesChanged === undefined || codeLinesChanged === null ? undefined : codeLinesChanged,
    inputTokens: inputTokens === undefined || inputTokens === null ? undefined : inputTokens,
    outputTokens: outputTokens === undefined || outputTokens === null ? undefined : outputTokens,
    totalTokens: totalTokens === undefined || totalTokens === null ? undefined : totalTokens,
  };
}

async function updateRoundRecord(roundId: number, input: Record<string, unknown>) {
  const existing = await localStorage.getRound(roundId);
  if (!existing) {
    throw new Error("Round not found");
  }

  const parsed = parseRoundRecordInput(input);

  const startedAt = parsed.startedAt ?? existing.startedAt;
  const endedAt = parsed.endedAt ?? existing.endedAt;
  const modelName = parsed.modelName ?? existing.modelName;
  if (!modelName || !modelName.trim()) {
    throw new Error("modelName is required");
  }

  const startedDate = new Date(startedAt);
  const endedDate = new Date(endedAt);
  if (Number.isNaN(startedDate.getTime()) || Number.isNaN(endedDate.getTime())) {
    throw new Error("startedAt/endedAt must be valid ISO strings");
  }
  if (endedDate.getTime() < startedDate.getTime()) {
    throw new Error("endedAt must be greater than or equal to startedAt");
  }

  const requirementId = parsed.requirementId !== undefined ? parsed.requirementId : existing.requirementId;
  const requirementSource =
    parsed.requirementId === undefined
      ? existing.requirementSource
      : requirementId === null
        ? "empty"
        : "context";

  const linesAdded = parsed.linesAdded ?? existing.linesAdded;
  const linesDeleted = parsed.linesDeleted ?? existing.linesDeleted;
  const codeLinesChanged = parsed.codeLinesChanged ?? linesAdded + linesDeleted;

  const inputTokens = parsed.inputTokens ?? existing.inputTokens;
  const outputTokens = parsed.outputTokens ?? existing.outputTokens;
  const totalTokens =
    parsed.totalTokens ??
    (parsed.inputTokens !== undefined || parsed.outputTokens !== undefined ? inputTokens + outputTokens : existing.totalTokens);

  const metadata =
    existing.metadata && typeof existing.metadata === "object" ? { ...(existing.metadata as Record<string, unknown>) } : {};
  if (parsed.client !== undefined) {
    if (parsed.client && parsed.client.trim()) {
      metadata.client = parsed.client.trim();
    } else {
      delete metadata.client;
    }
  }

  const now = new Date().toISOString();
  const updated: localStorage.Round = {
    ...existing,
    requirementId,
    requirementSource,
    modelName: modelName.trim(),
    startedAt,
    endedAt,
    promptText: parsed.promptText !== undefined ? parsed.promptText : existing.promptText,
    filesChanged: parsed.filesChanged !== undefined ? parsed.filesChanged : existing.filesChanged,
    linesAdded,
    linesDeleted,
    codeLinesChanged,
    inputTokens,
    outputTokens,
    totalTokens,
    metadata,
    tokenSyncStatus: totalTokens > 0 ? "synced" : existing.tokenSyncStatus,
    tokenSyncedAt: totalTokens > 0 ? now : existing.tokenSyncedAt,
    tokenSyncNote: totalTokens > 0 ? null : existing.tokenSyncNote,
    tokenSource: totalTokens > 0 && existing.tokenSource === "unavailable" ? "manual" : existing.tokenSource,
  };

  await localStorage.updateRound(updated);

  return {
    id: updated.id,
    conversationId: updated.conversationId,
    requirementId: updated.requirementId,
    modelName: updated.modelName,
    startedAt: updated.startedAt,
    endedAt: updated.endedAt,
    promptText: updated.promptText,
    filesChanged: updated.filesChanged,
    linesAdded: updated.linesAdded,
    linesDeleted: updated.linesDeleted,
    codeLinesChanged: updated.codeLinesChanged,
    inputTokens: updated.inputTokens,
    outputTokens: updated.outputTokens,
    totalTokens: updated.totalTokens,
    client: getRoundClient(updated),
  };
}

async function deleteRoundRecord(roundId: number) {
  await localStorage.deleteRound(roundId);
  return { ok: true, roundId, deleted: true };
}

async function getRequirementRecords() {
  const [requirements, rounds, reverts] = await Promise.all([
    localStorage.getRequirements(),
    localStorage.getRounds(),
    localStorage.getRoundReverts(),
  ]);

  const revertedRoundIds = new Set(reverts.map((revert) => revert.targetRoundId));
  const metrics = new Map<number, { roundCount: number; codeLinesChanged: number }>();

  for (const round of rounds) {
    if (round.requirementId === null) continue;
    if (revertedRoundIds.has(round.id)) continue;
    const entry = metrics.get(round.requirementId) ?? { roundCount: 0, codeLinesChanged: 0 };
    entry.roundCount++;
    entry.codeLinesChanged += round.codeLinesChanged;
    metrics.set(round.requirementId, entry);
  }

  return requirements
    .slice()
    .sort((a, b) => a.requirementId - b.requirementId)
    .map((record) => {
      const entry = metrics.get(record.requirementId) ?? { roundCount: 0, codeLinesChanged: 0 };
      return {
        requirementId: record.requirementId,
        requirementLabel: requirementLabel(record.requirementId, record),
        title: record.title,
        projectName: record.projectName,
        gpmNumber: record.gpmNumber,
        status: record.status,
        description: record.description,
        roundCount: entry.roundCount,
        codeLinesChanged: entry.codeLinesChanged,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    });
}

async function upsertRequirementRecord(requirementId: number, input: Record<string, unknown>) {
  if (!Number.isSafeInteger(requirementId) || requirementId <= 0) {
    throw new Error("requirementId must be a positive integer");
  }

  const payload = input as RequirementRecordInput;
  const now = new Date().toISOString();
  const existing = await localStorage.getRequirement(requirementId);

  const status =
    typeof payload.status === "string" && payload.status.trim()
      ? payload.status.trim()
      : existing?.status ?? "active";
  if (status !== "active" && status !== "done" && status !== "archived") {
    throw new Error("status must be active, done, or archived");
  }

  const record: localStorage.Requirement = {
    requirementId,
    title: typeof payload.title === "string" ? payload.title.trim() || null : payload.title ?? existing?.title ?? null,
    projectName:
      typeof payload.projectName === "string"
        ? payload.projectName.trim() || null
        : payload.projectName ?? existing?.projectName ?? null,
    gpmNumber:
      typeof payload.gpmNumber === "string"
        ? payload.gpmNumber.trim() || null
        : payload.gpmNumber ?? existing?.gpmNumber ?? null,
    status,
    description:
      typeof payload.description === "string"
        ? payload.description.trim() || null
        : payload.description ?? existing?.description ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await localStorage.saveRequirement(record);
  return {
    requirementId: record.requirementId,
    requirementLabel: requirementLabel(record.requirementId, record),
    title: record.title,
    projectName: record.projectName,
    gpmNumber: record.gpmNumber,
    status: record.status,
    description: record.description,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function deleteRequirementRecord(requirementId: number) {
  const deleted = await localStorage.deleteRequirement(requirementId);
  return { ok: true, requirementId, deleted };
}

function getLocalLogRoots(client: string): string[] {
  const home = homedir();
  if (client === "claude-code") {
    return [path.join(home, ".claude", "projects")];
  }
  return [path.join(home, ".codex")];
}

function kindForLogFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsonl") return "jsonl";
  if (ext === ".sqlite" || ext === ".db" || ext === ".sqlite3") return "sqlite";
  if (ext === ".log" || ext === ".txt") return "text";
  return ext ? ext.slice(1) : "file";
}

function isBinaryLog(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".sqlite" || ext === ".db" || ext === ".sqlite3";
}

function isAllowedLogPath(filePath: string): boolean {
  if (!path.isAbsolute(filePath)) return false;
  const resolved = path.resolve(filePath);
  const home = homedir();
  const allowedRoots = [
    path.resolve(path.join(home, ".codex")),
    path.resolve(path.join(home, ".claude", "projects")),
  ];
  return allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

async function listLocalLogFiles(searchParams: URLSearchParams) {
  const client = (searchParams.get("client") || "codex").trim();
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), maxLogFilesReturned);
  const search = searchParams.get("search")?.trim().toLowerCase() || "";

  const roots = getLocalLogRoots(client);
  const candidates: Array<{ path: string; size: number; mtime: string }> = [];
  let scanned = 0;
  let truncated = false;

  const stack: string[] = roots.slice();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (scanned >= maxLogFilesScanned) {
        truncated = true;
        break;
      }

      const fullPath = path.join(current, entry.name);
      scanned++;

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const normalized = fullPath.toLowerCase();
      if (search && !normalized.includes(search)) {
        continue;
      }

      const fileStat = await stat(fullPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) continue;
      candidates.push({
        path: fullPath,
        size: fileStat.size,
        mtime: new Date(fileStat.mtimeMs).toISOString(),
      });
    }

    if (truncated) break;
  }

  candidates.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return {
    client,
    scanned,
    truncated,
    files: candidates.slice(0, limit).map((file) => ({
      path: file.path,
      name: path.basename(file.path),
      directory: path.dirname(file.path),
      kind: kindForLogFile(file.path),
      size: file.size,
      mtime: file.mtime,
    })),
  };
}

async function readLocalLogFile(searchParams: URLSearchParams) {
  const filePath = searchParams.get("path") ?? "";
  if (!filePath.trim()) {
    throw new Error("path is required");
  }

  if (!isAllowedLogPath(filePath)) {
    throw new Error("path is not allowed");
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error("file not found");
  }

  if (isBinaryLog(filePath)) {
    return { path: filePath, binary: true, size: fileStat.size };
  }

  const tailBytesRaw = Number(searchParams.get("tailBytes") ?? defaultLogTailBytes);
  const requested = Math.min(
    Math.max(Number.isFinite(tailBytesRaw) ? tailBytesRaw : defaultLogTailBytes, 1),
    maxLogTailBytes
  );

  const size = fileStat.size;
  const tailBytes = Math.min(requested, size);
  const offset = Math.max(size - tailBytes, 0);

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(tailBytes);
    const result = await handle.read(buffer, 0, tailBytes, offset);
    const content = buffer.subarray(0, result.bytesRead).toString("utf8");
    return {
      path: filePath,
      binary: false,
      size,
      tailBytes: result.bytesRead,
      truncated: offset > 0,
      content,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function redirect(response: ServerResponse, location: string) {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

async function sendStatic(response: ServerResponse, filePath: string) {
  const fullPath = path.resolve(staticRoot, filePath);
  const withinRoot = fullPath === staticRoot || fullPath.startsWith(staticRoot + path.sep);
  if (!withinRoot) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  try {
    await stat(fullPath);
    const ext = path.extname(fullPath);
    const contentType = mimeTypes[ext] || "application/octet-stream";
    response.setHeader("Content-Type", contentType);
    const stream = createReadStream(fullPath);
    stream.on("error", () => {
      sendJson(response, 404, { error: "not_found" });
    });
    stream.pipe(response);
  } catch {
    sendJson(response, 404, { error: "not_found" });
  }
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name && value) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function isAuthenticated(request: IncomingMessage, config: DashboardConfig): boolean {
  const cookies = parseCookies(request.headers.cookie || "");
  const sessionCookie = cookies[cookieName];
  if (!sessionCookie) return false;

  const [signature, data] = sessionCookie.split(".");
  if (!signature || !data) return false;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as { exp?: number };
    if (!payload.exp || payload.exp <= Date.now()) return false;
  } catch {
    return false;
  }

  const expectedSignature = createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += String(chunk);
    });
    request.on("end", () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function handleLogin(request: IncomingMessage, response: ServerResponse, config: DashboardConfig) {
  const body = await readJsonBody(request);
  const username = typeof body.username === "string" ? body.username : undefined;
  const password = typeof body.password === "string" ? body.password : undefined;

  if (username === config.username && password === config.password) {
    const data = Buffer.from(
      JSON.stringify({
        exp: Date.now() + config.sessionTtlMs,
      })
    ).toString("base64url");
    const signature = createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${signature}.${data}; Path=/; HttpOnly; SameSite=Lax`
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 401, { error: "invalid_credentials" });
}

function clearSessionCookie(response: ServerResponse) {
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

function isMainModule(): boolean {
  const modulePath = fileURLToPath(import.meta.url);
  const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return argvPath === modulePath;
}

if (isMainModule()) {
  const config = getDashboardConfig();
  const server = createDashboardServer(config);

  server.listen(config.port, config.host);

  server.on("listening", () => {
    const address = server.address();
    const host = typeof address === "object" && address ? address.address : config.host;
    const port = typeof address === "object" && address ? address.port : config.port;
    console.log(`Dashboard server running at http://${host}:${port}`);
    console.log(`Username: ${config.username}`);
    console.log(`Password: ${config.password}`);
  });

  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

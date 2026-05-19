import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DashboardConfig, getDashboardConfig } from "./dashboard-config.js";
import * as localStorage from "./local-storage.js";

type FilterOptions = {
  from?: string;
  to?: string;
  model?: string;
  requirementId?: string;
  client?: string;
  tokenSyncStatus?: string;
  includeReverted: boolean;
  includeIgnored: boolean;
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
const projectRoot = path.resolve(moduleDir, "..");
const staticRoot = path.resolve(moduleDir, "..", "public", "dashboard");
const cookieName = "ai_coding_dashboard_session";
const execFileAsync = promisify(execFile);

const maxLogFilesReturned = 200;
const maxLogFilesScanned = 3000;
const maxLogTailBytes = 256 * 1024;
const defaultLogTailBytes = 64 * 1024;
const dashboardProxyRoutes: Record<string, string[]> = {
  "/api/filters": ["/filters"],
  "/api/summary": ["/summary"],
  "/api/requirements": ["/requirements", "/by-requirement"],
  "/api/models": ["/models", "/by-model"],
  "/api/timeline": ["/timeline"],
  "/api/rounds": ["/rounds"],
};

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
    await handleApi(request, url, response, config);
    return;
  }

  if (request.method === "GET") {
    const relativePath = url.pathname.replace(/^\/+/, "");
    await sendStatic(response, relativePath || "index.html");
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
}

async function handleApi(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  config: DashboardConfig
): Promise<void> {
  if (request.method === "GET") {
    const proxied = await proxyDashboardApi(request, url, response, config);
    if (proxied) return;
  }

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

  if (request.method === "GET" && url.pathname === "/api/corrections") {
    sendJson(response, 200, await getCorrections(url.searchParams));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sync-status") {
    sendJson(response, 200, await getSyncStatus());
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
  const roundCandidatesMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/token-candidates$/);
  if (roundCandidatesMatch && request.method === "GET") {
    sendJson(response, 200, await getRoundTokenCandidates(Number(roundCandidatesMatch[1])));
    return;
  }

  const bindTokenCandidateMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/token-candidates\/([1-9]\d*)\/bind$/);
  if (bindTokenCandidateMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await bindTokenCandidate(Number(bindTokenCandidateMatch[1]), Number(bindTokenCandidateMatch[2]), body)
    );
    return;
  }

  const resetRoundTokenMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/token-reset$/);
  if (resetRoundTokenMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await resetRoundToken(Number(resetRoundTokenMatch[1]), body));
    return;
  }

  const retryRoundTokenSyncMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/token-sync$/);
  if (retryRoundTokenSyncMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await retryRoundTokenSync(Number(retryRoundTokenSyncMatch[1]), body));
    return;
  }

  const ignoreRoundMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/ignore$/);
  if (ignoreRoundMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await setRoundIgnored(Number(ignoreRoundMatch[1]), true, body));
    return;
  }

  const restoreRoundMatch = url.pathname.match(/^\/api\/rounds\/([1-9]\d*)\/restore$/);
  if (restoreRoundMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await setRoundIgnored(Number(restoreRoundMatch[1]), false, body));
    return;
  }

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
    tokenSyncStatus: searchParams.get("tokenSyncStatus") || undefined,
    includeReverted: searchParams.get("includeReverted") === "true",
    includeIgnored: searchParams.get("includeIgnored") === "true",
  };
}

function isRoundIgnored(round: localStorage.Round): boolean {
  return Boolean(round.metadata && typeof round.metadata === "object" && round.metadata.ignoredForStats === true);
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
    if (filters.tokenSyncStatus && round.tokenSyncStatus !== filters.tokenSyncStatus) {
      return false;
    }
    if (!filters.includeIgnored && isRoundIgnored(round)) {
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
  let tokenPendingRounds = 0;
  let tokenNotFoundRounds = 0;
  let tokenAmbiguousRounds = 0;
  let tokenFailedRounds = 0;
  let claudeTokenRounds = 0;
  let codexTokenRounds = 0;
  let tokenSyncIssueRounds = 0;
  let lastTokenSyncedAt: string | null = null;
  let lastOnlineSyncedAt: string | null = null;
  const fileCategorySummary = createEmptyFileCategorySummary();

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
    if (round.tokenSyncStatus === "pending") {
      tokenPendingRounds++;
    }
    if (round.tokenSyncStatus === "not_found") {
      tokenNotFoundRounds++;
    }
    if (round.tokenSyncStatus === "ambiguous") {
      tokenAmbiguousRounds++;
    }
    if (round.tokenSyncStatus === "failed") {
      tokenFailedRounds++;
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
    if (round.tokenSyncedAt && (!lastTokenSyncedAt || new Date(round.tokenSyncedAt) > new Date(lastTokenSyncedAt))) {
      lastTokenSyncedAt = round.tokenSyncedAt;
    }
    const onlineSyncedAt = round._sync?.status === "synced" ? round._sync.syncedAt : undefined;
    if (onlineSyncedAt && (!lastOnlineSyncedAt || new Date(onlineSyncedAt) > new Date(lastOnlineSyncedAt))) {
      lastOnlineSyncedAt = onlineSyncedAt;
    }
    addFileCategorySummary(fileCategorySummary, round.metadata?.fileCategorySummary);
  }

  const revertedRounds = base.reduce((count, round) => count + (revertedRoundIds.has(round.id) ? 1 : 0), 0);
  const codeLinesPerKTokens = totalTokens > 0 ? (codeLinesChanged / totalTokens) * 1000 : null;
  const tokensPerCodeLine = codeLinesChanged > 0 ? totalTokens / codeLinesChanged : null;
  const tokenCompletenessRate = effective.length > 0 ? tokenSyncedRounds / effective.length : null;

  return {
    requirementCount: requirementIds.size,
    roundCount: effective.length,
    revertedRounds,
    unlinkedRounds,
    totalTokens,
    tokenMissingRounds,
    tokenPendingRounds,
    tokenNotFoundRounds,
    tokenAmbiguousRounds,
    tokenFailedRounds,
    codeLinesChanged,
    codeLinesPerKTokens,
    tokensPerCodeLine,
    tokenSyncedRounds,
    claudeTokenRounds,
    codexTokenRounds,
    tokenSyncIssueRounds,
    tokenCompletenessRate,
    lastTokenSyncedAt,
    lastOnlineSyncedAt,
    fileCategorySummary,
  };
}

function addFileCategorySummary(target: Record<string, number>, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const summary = value as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    const amount = Number(summary[key]);
    if (Number.isFinite(amount)) {
      target[key] += amount;
    }
  }
}

function createEmptyFileCategorySummary(): Record<string, number> {
  return {
    sourceLinesChanged: 0,
    docLinesChanged: 0,
    configLinesChanged: 0,
    testLinesChanged: 0,
    generatedLinesChanged: 0,
    otherLinesChanged: 0,
  };
}

async function getSyncStatus() {
  const state = await localStorage.getAutoSyncState();
  const now = Date.now();
  const heartbeatAt = state?.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : 0;
  const running = Boolean(state && state.status === "running" && heartbeatAt > 0 && now - heartbeatAt < 2 * 60 * 1000);

  return {
    configured: true,
    running,
    stale: Boolean(state && state.status === "running" && (!heartbeatAt || now - heartbeatAt >= 2 * 60 * 1000)),
    state,
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
      tokenSyncedRounds: number;
      tokenPendingRounds: number;
      tokenIssueRounds: number;
      tokenCompletenessRate: number | null;
      lastTokenSyncedAt: string | null;
      codeLinesPerKTokens: number | null;
      fileCategorySummary: Record<string, number>;
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
        tokenSyncedRounds: 0,
        tokenPendingRounds: 0,
        tokenIssueRounds: 0,
        tokenCompletenessRate: null,
        lastTokenSyncedAt: null,
        codeLinesPerKTokens: null,
        fileCategorySummary: createEmptyFileCategorySummary(),
      };
      groups.set(reqId, group);
    }

    group.roundCount++;
    group.durationMs += safeDurationMs(round);
    group.codeLinesChanged += round.codeLinesChanged;
    group.totalTokens += round.totalTokens;
    if (round.tokenSyncStatus === "synced") {
      group.tokenSyncedRounds++;
    }
    if (round.tokenSyncStatus === "pending") {
      group.tokenPendingRounds++;
    }
    if (round.tokenSyncStatus === "not_found" || round.tokenSyncStatus === "ambiguous" || round.tokenSyncStatus === "failed") {
      group.tokenIssueRounds++;
    }
    if (round.tokenSyncedAt && (!group.lastTokenSyncedAt || new Date(round.tokenSyncedAt) > new Date(group.lastTokenSyncedAt))) {
      group.lastTokenSyncedAt = round.tokenSyncedAt;
    }

    if (!group.firstStartedAt || new Date(round.startedAt) < new Date(group.firstStartedAt)) {
      group.firstStartedAt = round.startedAt;
    }
    if (!group.lastEndedAt || new Date(round.endedAt) > new Date(group.lastEndedAt)) {
      group.lastEndedAt = round.endedAt;
    }
    addFileCategorySummary(group.fileCategorySummary, round.metadata?.fileCategorySummary);
  }

  for (const group of groups.values()) {
    group.codeLinesPerKTokens = group.totalTokens > 0 ? (group.codeLinesChanged / group.totalTokens) * 1000 : null;
    group.tokenCompletenessRate = group.roundCount > 0 ? group.tokenSyncedRounds / group.roundCount : null;
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
      tokenMatchQuality: round.tokenMatchQuality ?? null,
      tokenSyncStatus: round.tokenSyncStatus,
      tokenSyncedAt: round.tokenSyncedAt,
      tokenSyncNote: round.tokenSyncNote,
      isReverted: revertedRoundIds.has(round.id),
      isIgnored: isRoundIgnored(round),
      promptText: round.promptText ?? "",
    };
  });
}

async function getFilters() {
  const [rounds, requirementRecords] = await Promise.all([localStorage.getRounds(), localStorage.getRequirements()]);
  const models = new Set<string>();
  const requirementIds = new Set<number>();
  const clients = new Set<string>();
  const tokenSyncStatuses = new Set<string>();
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
    if (round.tokenSyncStatus) {
      tokenSyncStatuses.add(round.tokenSyncStatus);
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
    tokenSyncStatuses: Array.from(tokenSyncStatuses).sort(),
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
    tokenMatchQuality: totalTokens > 0 && existing.tokenSource === "unavailable" ? "manual" : existing.tokenMatchQuality ?? null,
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

async function getRoundTokenCandidates(roundId: number) {
  const round = await localStorage.getRound(roundId);
  if (!round) {
    throw new Error("Round not found");
  }

  const [candidates, corrections] = await Promise.all([
    localStorage.getTokenUsageCandidates(roundId),
    localStorage.getAiCodingCorrections(roundId),
  ]);

  return {
    roundId,
    tokenSyncStatus: round.tokenSyncStatus,
    tokenMatchQuality: round.tokenMatchQuality ?? null,
    totalTokens: round.totalTokens,
    candidates: candidates
      .slice()
      .sort((a, b) => {
        const selectedCompare = Number(Boolean(b.selectedAt)) - Number(Boolean(a.selectedAt));
        if (selectedCompare !== 0) return selectedCompare;
        return b.id - a.id;
      })
      .map((candidate) => ({
        id: candidate.id,
        client: candidate.client,
        sourcePath: candidate.sourcePath,
        sourceEventId: candidate.sourceEventId,
        conversationId: candidate.conversationId,
        turnId: candidate.turnId,
        modelName: candidate.modelName,
        startedAt: candidate.startedAt,
        endedAt: candidate.endedAt,
        inputTokens: candidate.inputTokens,
        outputTokens: candidate.outputTokens,
        totalTokens: candidate.totalTokens,
        matchQuality: candidate.matchQuality,
        note: candidate.note,
        selectedAt: candidate.selectedAt,
        createdAt: candidate.createdAt,
      })),
    corrections: corrections
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map((correction) => ({
        id: correction.id,
        correctionType: correction.correctionType,
        targetType: correction.targetType,
        targetId: correction.targetId,
        actor: correction.actor,
        reason: correction.reason,
        createdAt: correction.createdAt,
      })),
  };
}

async function getCorrections(searchParams: URLSearchParams) {
  const roundIdRaw = searchParams.get("roundId");
  const roundId = roundIdRaw ? Number(roundIdRaw) : undefined;
  if (roundIdRaw && (!Number.isSafeInteger(roundId) || Number(roundId) <= 0)) {
    throw new Error("roundId must be a positive integer");
  }

  const limitRaw = Number(searchParams.get("limit") ?? 100);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);
  const corrections = await localStorage.getAiCodingCorrections(roundId);
  return corrections
    .slice()
    .sort((a, b) => {
      const time = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (time !== 0) return time;
      return b.id - a.id;
    })
    .slice(0, limit)
    .map((correction) => ({
      id: correction.id,
      correctionType: correction.correctionType,
      targetType: correction.targetType,
      targetId: correction.targetId,
      roundId: correction.roundId,
      actor: correction.actor,
      reason: correction.reason,
      before: correction.before,
      after: correction.after,
      createdAt: correction.createdAt,
    }));
}

async function bindTokenCandidate(roundId: number, candidateId: number, input: Record<string, unknown>) {
  const [round, candidate] = await Promise.all([
    localStorage.getRound(roundId),
    localStorage.getTokenUsageCandidate(candidateId),
  ]);

  if (!round) {
    throw new Error("Round not found");
  }
  if (!candidate || candidate.roundId !== roundId) {
    throw new Error("Token usage candidate not found for this round");
  }

  const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "dashboard";
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
  const now = new Date().toISOString();
  const tokenSource = candidate.client === "claude-code" ? "claude_jsonl" : "codex_log";

  const before = roundTokenSnapshot(round);
  const updated: localStorage.Round = {
    ...round,
    inputTokens: candidate.inputTokens,
    outputTokens: candidate.outputTokens,
    totalTokens: candidate.totalTokens,
    modelName: candidate.modelName ?? round.modelName,
    tokenSource,
    tokenMatchQuality: "manual",
    tokenSyncStatus: "synced",
    tokenSyncedAt: now,
    tokenSyncNote: `Manually bound candidate ${candidate.id}${reason ? `: ${reason}` : ""}`,
  };
  await localStorage.updateRound(updated);

  const event = await localStorage.createTokenUsageEvent({
    roundId,
    client: candidate.client,
    sourcePath: candidate.sourcePath,
    sourceEventId: candidate.sourceEventId,
    conversationId: candidate.conversationId,
    turnId: candidate.turnId,
    modelName: candidate.modelName,
    startedAt: candidate.startedAt,
    endedAt: candidate.endedAt,
    inputTokens: candidate.inputTokens,
    outputTokens: candidate.outputTokens,
    totalTokens: candidate.totalTokens,
    matchQuality: "manual",
    rawEvent: {
      ...(candidate.rawEvent || {}),
      manualBindCandidateId: candidate.id,
      originalMatchQuality: candidate.matchQuality,
    },
  });

  await localStorage.updateTokenUsageCandidate({
    ...candidate,
    selectedAt: now,
  });

  const correction = await localStorage.createAiCodingCorrection({
    correctionType: "token_manual_bind",
    targetType: "token_usage_candidate",
    targetId: candidate.id,
    roundId,
    actor,
    reason,
    before,
    after: {
      ...roundTokenSnapshot(updated),
      tokenUsageEventId: event.id,
      tokenUsageCandidateId: candidate.id,
    },
  });

  return {
    ok: true,
    roundId,
    candidateId,
    tokenUsageEventId: event.id,
    correctionId: correction.id,
    totalTokens: updated.totalTokens,
    tokenSyncStatus: updated.tokenSyncStatus,
    tokenMatchQuality: updated.tokenMatchQuality,
  };
}

async function resetRoundToken(roundId: number, input: Record<string, unknown>) {
  const round = await localStorage.getRound(roundId);
  if (!round) {
    throw new Error("Round not found");
  }

  const actor = actorFromInput(input);
  const reason = reasonFromInput(input) ?? "reset token usage";
  const before = roundTokenSnapshot(round);
  const updated: localStorage.Round = {
    ...round,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokenSource: "unavailable",
    tokenMatchQuality: null,
    tokenSyncStatus: "pending",
    tokenSyncedAt: new Date().toISOString(),
    tokenSyncNote: reason,
  };

  await localStorage.updateRound(updated);
  const deletedTokenUsageEvents = await localStorage.deleteTokenUsageEventsByRound(roundId);
  const deletedTokenUsageCandidates = await localStorage.deleteTokenUsageCandidatesByRound(roundId);

  const correction = await localStorage.createAiCodingCorrection({
    correctionType: "token_reset",
    targetType: "round",
    targetId: roundId,
    roundId,
    actor,
    reason,
    before,
    after: {
      ...roundTokenSnapshot(updated),
      deletedTokenUsageEvents,
      deletedTokenUsageCandidates,
    },
  });

  return {
    ok: true,
    roundId,
    correctionId: correction.id,
    deletedTokenUsageEvents,
    deletedTokenUsageCandidates,
    tokenSyncStatus: updated.tokenSyncStatus,
  };
}

async function retryRoundTokenSync(roundId: number, input: Record<string, unknown>) {
  const before = await localStorage.getRound(roundId);
  if (!before) {
    throw new Error("Round not found");
  }

  const actor = actorFromInput(input);
  const reason = reasonFromInput(input) ?? "manual token sync retry";
  const metadataProjectPath =
    before.metadata && typeof before.metadata.projectPath === "string" ? before.metadata.projectPath : undefined;
  const projectPath = typeof input.projectPath === "string" && input.projectPath.trim()
    ? input.projectPath.trim()
    : metadataProjectPath;

  const args = [
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(projectRoot, "scripts", "sync-token-usage.ts"),
    "--round-id",
    String(roundId),
  ];
  if (projectPath) {
    args.push("--project", projectPath);
  }

  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  const after = await localStorage.getRound(roundId);
  if (!after) {
    throw new Error("Round disappeared after token sync");
  }

  const correction = await localStorage.createAiCodingCorrection({
    correctionType: "round_update",
    targetType: "round",
    targetId: roundId,
    roundId,
    actor,
    reason,
    before: roundTokenSnapshot(before),
    after: {
      ...roundTokenSnapshot(after),
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000),
    },
  });

  return {
    ok: true,
    roundId,
    correctionId: correction.id,
    tokenSyncStatus: after.tokenSyncStatus,
    tokenMatchQuality: after.tokenMatchQuality ?? null,
    totalTokens: after.totalTokens,
    stdout: stdout.slice(-4000),
    stderr: stderr.slice(-4000),
  };
}

async function setRoundIgnored(roundId: number, ignored: boolean, input: Record<string, unknown>) {
  const round = await localStorage.getRound(roundId);
  if (!round) {
    throw new Error("Round not found");
  }

  const actor = actorFromInput(input);
  const reason = reasonFromInput(input) ?? (ignored ? "ignore round from effective statistics" : "restore round to effective statistics");
  const before = roundMetadataSnapshot(round);
  const metadata = round.metadata && typeof round.metadata === "object" ? { ...round.metadata } : {};
  if (ignored) {
    metadata.ignoredForStats = true;
    metadata.ignoredAt = new Date().toISOString();
    metadata.ignoredReason = reason;
  } else {
    delete metadata.ignoredForStats;
    delete metadata.ignoredAt;
    delete metadata.ignoredReason;
  }

  const updated: localStorage.Round = {
    ...round,
    metadata,
  };
  await localStorage.updateRound(updated);

  const correction = await localStorage.createAiCodingCorrection({
    correctionType: ignored ? "round_ignore" : "round_restore",
    targetType: "round",
    targetId: roundId,
    roundId,
    actor,
    reason,
    before,
    after: roundMetadataSnapshot(updated),
  });

  return {
    ok: true,
    roundId,
    ignored,
    correctionId: correction.id,
  };
}

function actorFromInput(input: Record<string, unknown>): string {
  return typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "dashboard";
}

function reasonFromInput(input: Record<string, unknown>): string | null {
  return typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
}

function roundTokenSnapshot(round: localStorage.Round): Record<string, unknown> {
  return {
    inputTokens: round.inputTokens,
    outputTokens: round.outputTokens,
    totalTokens: round.totalTokens,
    modelName: round.modelName,
    tokenSource: round.tokenSource,
    tokenMatchQuality: round.tokenMatchQuality ?? null,
    tokenSyncStatus: round.tokenSyncStatus,
    tokenSyncedAt: round.tokenSyncedAt,
    tokenSyncNote: round.tokenSyncNote,
  };
}

function roundMetadataSnapshot(round: localStorage.Round): Record<string, unknown> {
  return {
    requirementId: round.requirementId,
    modelName: round.modelName,
    promptText: round.promptText,
    ignoredForStats: isRoundIgnored(round),
    metadata: round.metadata ?? null,
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

async function proxyDashboardApi(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  config: DashboardConfig
): Promise<boolean> {
  const remotePaths = dashboardProxyRoutes[url.pathname];
  if (!remotePaths) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.dashboardApiTimeoutMs);

  try {
    const headers = buildProxyHeaders(request);
    let lastFailure: { targetUrl: string; status: number; body: string } | undefined;

    for (const remotePath of remotePaths) {
      const targetUrl = `${config.dashboardApiBaseUrl}${remotePath}${url.search}`;
      const remoteResponse = await fetch(targetUrl, {
        method: request.method,
        headers,
        signal: controller.signal,
      });

      const body = await remoteResponse.text();
      if (remoteResponse.ok) {
        const contentType = remoteResponse.headers.get("content-type") || "application/json; charset=utf-8";
        const proxiedBody = normalizeDashboardProxyBody(url.pathname, body, contentType);
        response.statusCode = remoteResponse.status;
        response.setHeader("Content-Type", contentType);
        response.end(proxiedBody);
        return true;
      }

      lastFailure = {
        targetUrl,
        status: remoteResponse.status,
        body,
      };

      if (!shouldTryNextDashboardProxyPath(remoteResponse.status)) break;
    }

    if (config.dashboardApiFallbackLocal) {
      console.warn(`Dashboard API proxy fallback: ${lastFailure?.targetUrl ?? url.pathname} returned ${lastFailure?.status ?? "unknown"}`);
      return false;
    }

    response.statusCode = lastFailure?.status ?? 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(lastFailure?.body || JSON.stringify({ error: "dashboard_api_unavailable" }));
    return true;
  } catch (error) {
    if (config.dashboardApiFallbackLocal) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Dashboard API proxy fallback: ${url.pathname} failed: ${message}`);
      return false;
    }

    sendJson(response, 502, {
      error: "dashboard_api_unavailable",
      message: error instanceof Error ? error.message : "Dashboard API request failed",
    });
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldTryNextDashboardProxyPath(status: number): boolean {
  return status === 404 || status === 405 || status === 424 || status >= 500;
}

function normalizeDashboardProxyBody(pathname: string, body: string, contentType: string): string {
  if (!contentType.toLowerCase().includes("application/json")) return body;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (isDashboardApiEnvelope(parsed)) {
      return JSON.stringify(normalizeDashboardProxyData(pathname, parsed.data));
    }
    return JSON.stringify(normalizeDashboardProxyData(pathname, parsed));
  } catch {
    return body;
  }
}

function isDashboardApiEnvelope(value: unknown): value is { data: unknown } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return "data" in record && ("code" in record || "ok" in record || "msg" in record);
}

function normalizeDashboardProxyData(pathname: string, data: unknown): unknown {
  if (pathname === "/api/filters" && data && typeof data === "object" && !Array.isArray(data)) {
    const record = { ...(data as Record<string, unknown>) };
    if (!Array.isArray(record.tokenSyncStatuses)) {
      record.tokenSyncStatuses = ["pending", "synced", "not_found", "ambiguous", "failed"];
    }
    return record;
  }

  if (pathname === "/api/summary" && data && typeof data === "object" && !Array.isArray(data)) {
    const record = { ...(data as Record<string, unknown>) };
    record.tokenPendingRounds = record.tokenPendingRounds ?? record.tokenMissingRounds ?? 0;
    record.tokenNotFoundRounds = record.tokenNotFoundRounds ?? 0;
    record.tokenAmbiguousRounds = record.tokenAmbiguousRounds ?? 0;
    record.tokenFailedRounds = record.tokenFailedRounds ?? 0;
    const issueRounds =
      toNumber(record.tokenNotFoundRounds) + toNumber(record.tokenAmbiguousRounds) + toNumber(record.tokenFailedRounds);
    record.tokenSyncIssueRounds = record.tokenSyncIssueRounds ?? issueRounds;
    record.tokenCompletenessRate = record.tokenCompletenessRate ?? calculateCompletenessRate(record.roundCount, record.tokenSyncedRounds);
    record.lastTokenSyncedAt = record.lastTokenSyncedAt ?? null;
    record.lastOnlineSyncedAt = record.lastOnlineSyncedAt ?? null;
    record.fileCategorySummary = record.fileCategorySummary ?? createEmptyFileCategorySummary();
    return record;
  }

  if (pathname === "/api/requirements" && Array.isArray(data)) {
    return data.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const record = { ...(item as Record<string, unknown>) };
      record.tokenPendingRounds = record.tokenPendingRounds ?? 0;
      record.tokenIssueRounds = record.tokenIssueRounds ?? 0;
      record.tokenCompletenessRate = normalizeRequirementCompletenessRate(record);
      record.lastTokenSyncedAt = record.lastTokenSyncedAt ?? null;
      record.fileCategorySummary = record.fileCategorySummary ?? createEmptyFileCategorySummary();
      return record;
    });
  }

  return data;
}

function calculateCompletenessRate(roundCount: unknown, tokenSyncedRounds: unknown): number {
  const total = toNumber(roundCount);
  if (total <= 0) return 1;

  return toNumber(tokenSyncedRounds) / total;
}

function calculateRequirementCompletenessRate(record: Record<string, unknown>): number {
  if (record.tokenSyncedRounds !== undefined) {
    return calculateCompletenessRate(record.roundCount, record.tokenSyncedRounds);
  }

  const total = toNumber(record.roundCount);
  if (total <= 0) return 1;

  const pending = toNumber(record.tokenPendingRounds);
  const issues = toNumber(record.tokenIssueRounds);
  const missing = pending + issues;
  if (missing > 0) {
    return Math.max((total - missing) / total, 0);
  }

  return toNumber(record.totalTokens) > 0 ? 1 : 0;
}

function normalizeRequirementCompletenessRate(record: Record<string, unknown>): number {
  const calculated = calculateRequirementCompletenessRate(record);
  if (record.tokenCompletenessRate === undefined || record.tokenCompletenessRate === null) {
    return calculated;
  }

  const provided = toNumber(record.tokenCompletenessRate);
  const hasNoTokenIssues = toNumber(record.tokenPendingRounds) === 0 && toNumber(record.tokenIssueRounds) === 0;
  if (provided === 0 && calculated > 0 && hasNoTokenIssues && toNumber(record.totalTokens) > 0) {
    return calculated;
  }

  return provided;
}

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildProxyHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  const accept = request.headers.accept;
  if (accept) headers.set("Accept", Array.isArray(accept) ? accept.join(", ") : accept);

  const authorization = request.headers.authorization;
  if (authorization) {
    headers.set("Authorization", Array.isArray(authorization) ? authorization[0] : authorization);
  }

  return headers;
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

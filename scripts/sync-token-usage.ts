import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { closePool } from "../src/database.js";
import * as localStorage from "../src/local-storage.js";

type ClientName = "codex" | "claude-code";
type SyncStatus = "synced" | "not_found" | "ambiguous" | "failed";

type Args = {
  client?: ClientName;
  roundId?: number;
  project?: string;
  since?: string;
  dryRun: boolean;
};

type RoundRow = {
  id: number;
  conversation_id: string;
  model_name: string;
  prompt_text: string | null;
  started_at: string;
  ended_at: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  metadata_json: string | null;
};

type RoundCandidate = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sourcePath: string;
  sourceEventId: string;
  conversationId?: string;
  turnId?: string;
  modelName?: string;
  startedAt?: Date;
  endedAt?: Date;
  rawEvent: Record<string, unknown>;
  note?: string;
  matchQuality?: "exact_tool_call" | "turn_id" | "prompt_tool_call" | "time_window";
  matchCallId?: string;
};

type CodexUsageLogRow = {
  id: number;
  ts: number;
  body: string;
  threadId?: string;
  turnId?: string;
  modelName?: string;
};

type CodexTokenUsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
};

type CodexRolloutTokenEvent = {
  lineNumber: number;
  timestamp: Date;
  usage: CodexTokenUsageSnapshot;
};

type CodexRolloutTurn = {
  turnId: string;
  cwd?: string;
  modelName?: string;
  startedAt: Date;
  completedAt?: Date;
  baselineUsage?: CodexTokenUsageSnapshot;
  tokenEvents: CodexRolloutTokenEvent[];
  recordCall?: {
    callId: string;
    lineNumber: number;
  };
};

type SyncResult = {
  roundId: number;
  status: SyncStatus;
  client: ClientName;
  totalTokens?: number;
  note?: string;
};

const args = parseArgs(process.argv.slice(2));

try {
  const rounds = await loadPendingRounds(args);
  const clients: ClientName[] = args.client ? [args.client] : ["claude-code", "codex"];
  const results: SyncResult[] = [];

  for (const round of rounds) {
    const metadata = parseMetadata(round.metadata_json);
    const preferredClient = normalizeClient(metadata.client);
    const roundClients = args.client
      ? clients
      : preferredClient
        ? [preferredClient]
        : clients;

    let matched = false;
    for (const client of roundClients) {
      const result = await syncRound(round, client, args);
      results.push(result);
      if (result.status === "synced") {
        matched = true;
        break;
      }
    }

    if (!matched && roundClients.length > 1) {
      await markRound(round.id, "not_found", "No token usage found in configured clients", args.dryRun);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    roundsChecked: rounds.length,
    results
  }, null, 2));
} finally {
  await closePool();
}

async function syncRound(round: RoundRow, client: ClientName, args: Args): Promise<SyncResult> {
  try {
    const candidates = client === "claude-code"
      ? await findClaudeCandidates(round, args)
      : await findCodexCandidates(round, args);

    if (candidates.length === 0) {
      await markRound(round.id, "not_found", `No ${client} token usage event matched`, args.dryRun);
      return { roundId: round.id, status: "not_found", client };
    }

    if (candidates.length > 1) {
      await saveCandidates(round.id, client, candidates, args.dryRun);
      await markRound(round.id, "ambiguous", `${candidates.length} ${client} token usage events matched`, args.dryRun);
      return { roundId: round.id, status: "ambiguous", client, note: `${candidates.length} candidates` };
    }

    const existingRoundId = await findExistingTokenEventRound(client, candidates[0]);
    if (existingRoundId !== null && existingRoundId !== round.id) {
      const note = `${client} token usage event already assigned to round ${existingRoundId}`;
      await markRound(round.id, "ambiguous", note, args.dryRun);
      return { roundId: round.id, status: "ambiguous", client, note };
    }

    await applyCandidate(round.id, client, candidates[0], args.dryRun);
    return {
      roundId: round.id,
      status: "synced",
      client,
      totalTokens: candidates[0].totalTokens,
      note: candidates[0].note
    };
  } catch (error) {
    const note = error instanceof Error ? error.message : "Unknown sync failure";
    await markRound(round.id, "failed", note, args.dryRun);
    return { roundId: round.id, status: "failed", client, note };
  }
}

async function saveCandidates(
  roundId: number,
  client: ClientName,
  candidates: RoundCandidate[],
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  await localStorage.replaceTokenUsageCandidates(
    roundId,
    client,
    candidates.slice(0, 20).map((candidate) => ({
      roundId,
      client,
      sourcePath: candidate.sourcePath,
      sourceEventId: candidate.sourceEventId,
      conversationId: candidate.conversationId ?? null,
      turnId: candidate.turnId ?? null,
      modelName: candidate.modelName ?? null,
      startedAt: candidate.startedAt ? candidate.startedAt.toISOString() : null,
      endedAt: candidate.endedAt ? candidate.endedAt.toISOString() : null,
      inputTokens: candidate.inputTokens,
      outputTokens: candidate.outputTokens,
      totalTokens: candidate.totalTokens,
      matchQuality: candidate.matchQuality ?? null,
      note: candidate.note ?? null,
      rawEvent: candidate.rawEvent ?? null,
    }))
  );
}

async function findExistingTokenEventRound(
  client: ClientName,
  candidate: RoundCandidate
): Promise<number | null> {
  const events = await localStorage.getTokenUsageEvents();
  const matched = events
    .filter((event) => event.client === client)
    .filter((event) => event.sourcePath === candidate.sourcePath)
    .filter((event) => event.sourceEventId === candidate.sourceEventId)
    .filter((event) => event.roundId !== null)
    .sort((a, b) => b.id - a.id)[0];

  const value = matched?.roundId;
  return value === undefined || value === null ? null : Number(value);
}

async function loadPendingRounds(args: Args): Promise<RoundRow[]> {
  const rounds = await localStorage.getRounds();
  const reverts = await localStorage.getRoundReverts();
  const revertedRoundIds = new Set(reverts.map((revert) => revert.targetRoundId));

  const since = args.since ? new Date(args.since) : null;
  if (since && Number.isNaN(since.getTime())) {
    throw new Error(`--since must be a valid date-time string, got ${args.since}`);
  }

  const pending = rounds
    .filter((round) => !revertedRoundIds.has(round.id))
    .filter((round) => round.totalTokens === 0 || ["pending", "not_found", "failed"].includes(String(round.tokenSyncStatus)))
    .filter((round) => args.roundId === undefined || round.id === args.roundId)
    .filter((round) => {
      if (!args.project) return true;
      const metadataProjectPath = typeof round.metadata?.projectPath === "string" ? String(round.metadata.projectPath) : undefined;
      if (metadataProjectPath && sameProjectPath(metadataProjectPath, args.project)) return true;

      const roundProject = projectFromConversation(round.conversationId);
      if (roundProject && sameProjectPath(roundProject, args.project)) return true;

      const prefixes = [`codex:${args.project}`, `claude:${args.project}`];
      if (prefixes.includes(round.conversationId)) return true;
      if (round.conversationId.startsWith(`codex:${args.project}:`)) return true;
      if (round.conversationId.startsWith(`claude:${args.project}:`)) return true;
      return false;
    })
    .filter((round) => {
      if (!since) return true;
      return new Date(round.startedAt).getTime() >= since.getTime();
    })
    .filter((round) => {
      if (!args.client) return true;
      const metadataClient = normalizeClient(round.metadata?.client);
      if (metadataClient) return metadataClient === args.client;
      return args.client === "claude-code"
        ? round.conversationId.startsWith("claude:")
        : round.conversationId.startsWith("codex:");
    })
    .sort((a, b) => {
      const timeA = new Date(a.startedAt).getTime();
      const timeB = new Date(b.startedAt).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return a.id - b.id;
    })
    .slice(0, 200)
    .map((round): RoundRow => ({
      id: round.id,
      conversation_id: round.conversationId,
      model_name: round.modelName,
      prompt_text: round.promptText ?? null,
      started_at: round.startedAt,
      ended_at: round.endedAt,
      input_tokens: round.inputTokens,
      output_tokens: round.outputTokens,
      total_tokens: round.totalTokens,
      metadata_json: round.metadata ? JSON.stringify(round.metadata) : null,
    }));

  return pending;
}

async function findClaudeCandidates(round: RoundRow, args: Args): Promise<RoundCandidate[]> {
  const metadata = parseMetadata(round.metadata_json);
  const projectPath = args.project ?? stringValue(metadata.projectPath) ?? projectFromConversation(round.conversation_id);
  const startedAt = toDate(round.started_at);
  const endedAt = toDate(round.ended_at);
  const files = await findClaudeProjectFiles(projectPath);
  const candidates: RoundCandidate[] = [];

  for (const file of files) {
    const successfulRecordCallIds = await findSuccessfulClaudeRecordCallIds(file, round.id);
    for await (const event of readJsonLines(file)) {
      if (!isObject(event)) continue;
      if (event.type !== "assistant" || !isObject(event.message)) continue;
      if (!isSameOrChildPath(stringValue(event.cwd), projectPath)) continue;

      const usage = isObject(event.message.usage) ? event.message.usage : null;
      if (!usage) continue;

      const timestamp = new Date(String(event.timestamp ?? ""));
      const mcpToolMatch = findRoundRecordToolMatch(event.message, round);
      if (successfulRecordCallIds.size > 0 && (!mcpToolMatch || !successfulRecordCallIds.has(mcpToolMatch.callId))) {
        continue;
      }
      if (!mcpToolMatch && !isWithinWindow(timestamp, startedAt, endedAt, 90_000)) continue;

      const inputTokens = numberValue(usage.input_tokens);
      const outputTokens = numberValue(usage.output_tokens);
      const cacheCreationTokens = numberValue(usage.cache_creation_input_tokens);
      const cacheReadTokens = numberValue(usage.cache_read_input_tokens);
      const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      if (totalTokens <= 0) continue;

      candidates.push({
        inputTokens: inputTokens + cacheCreationTokens + cacheReadTokens,
        outputTokens,
        totalTokens,
        sourcePath: file,
        sourceEventId: stringValue(event.uuid) ?? eventHash(event),
        conversationId: stringValue(event.sessionId),
        turnId: stringValue(event.uuid),
        modelName: stringValue(event.message.model),
        startedAt: timestamp,
        endedAt: timestamp,
        rawEvent: slimRawEvent(event),
        note: mcpToolMatch
          ? "Claude usage matched by MCP record tool call; includes cache creation/read input tokens"
          : "Claude usage matched by time window; includes cache creation/read input tokens",
        matchQuality: mcpToolMatch?.quality ?? "time_window",
        matchCallId: mcpToolMatch?.callId
      });
    }
  }

  return preferBestClaudeCandidates(dedupeCandidates(candidates));
}

async function findSuccessfulClaudeRecordCallIds(filePath: string, roundId: number): Promise<Set<string>> {
  const callIds = new Set<string>();

  for await (const event of readJsonLines(filePath)) {
    if (!isObject(event) || event.type !== "user" || !isObject(event.message)) continue;
    if (!Array.isArray(event.message.content)) continue;

    for (const item of event.message.content) {
      if (!isObject(item) || item.type !== "tool_result") continue;
      const toolUseId = stringValue(item.tool_use_id);
      const content = stringValue(item.content);
      if (!toolUseId || !content) continue;

      const parsed = parseJsonObject(content);
      if (Number(parsed?.id) === roundId) {
        callIds.add(toolUseId);
      }
    }
  }

  return callIds;
}

function findRoundRecordToolMatch(
  message: Record<string, unknown>,
  round: RoundRow
): { input: Record<string, unknown>; quality: "exact_tool_call" | "prompt_tool_call"; callId: string } | null {
  if (!Array.isArray(message.content)) return null;

  let promptMatch: { input: Record<string, unknown>; callId: string } | null = null;

  for (const item of message.content) {
    if (!isObject(item)) continue;
    if (item.type !== "tool_use") continue;
    const name = stringValue(item.name);
    if (!name || !name.includes("record_ai_coding_round")) continue;
    if (!isObject(item.input)) continue;
    const callId = stringValue(item.id);
    if (!callId) continue;

    const input = item.input;
    if (input.conversationId !== round.conversation_id) continue;

    const inputStartedAt = stringValue(input.startedAt);
    const inputEndedAt = stringValue(input.endedAt);
    if (inputStartedAt && inputEndedAt) {
      const startedMatches = sameMysqlDateTime(inputStartedAt, round.started_at);
      const endedMatches = sameMysqlDateTime(inputEndedAt, round.ended_at);
      if (startedMatches && endedMatches) return { input, quality: "exact_tool_call", callId };
    }

    if (
      typeof input.promptText === "string" &&
      input.promptText.length > 0 &&
      stringValue(input.promptText) === stringValue(round.prompt_text)
    ) {
      promptMatch = { input, callId };
    }
  }

  return promptMatch
    ? { input: promptMatch.input, quality: "prompt_tool_call", callId: promptMatch.callId }
    : null;
}

function preferBestClaudeCandidates(candidates: RoundCandidate[]): RoundCandidate[] {
  const exactToolCallCandidates = candidates.filter((candidate) => candidate.matchQuality === "exact_tool_call");
  if (exactToolCallCandidates.length > 0) return exactToolCallCandidates;

  const promptToolCallCandidates = candidates.filter((candidate) => candidate.matchQuality === "prompt_tool_call");
  if (promptToolCallCandidates.length > 0) return promptToolCallCandidates;

  return candidates;
}

function sameMysqlDateTime(inputValue: string, dbValue: Date | string): boolean {
  return toMysqlDateTime(inputValue) === toMysqlDateTime(toDate(dbValue).toISOString());
}

async function findCodexCandidates(round: RoundRow, args: Args): Promise<RoundCandidate[]> {
  const metadata = parseMetadata(round.metadata_json);
  const projectPath = args.project ?? stringValue(metadata.projectPath) ?? projectFromConversation(round.conversation_id);
  const rolloutCandidates = await findCodexRolloutCandidates(round, projectPath);
  if (rolloutCandidates.length > 0) return dedupeCandidates(rolloutCandidates);

  const expectedTurnId = stringValue(metadata.turnId);
  const explicitThreadId = stringValue(metadata.threadId) ?? extractCodexThreadId(round.conversation_id);
  const startedAt = toDate(round.started_at);
  const endedAt = toDate(round.ended_at);
  const threadIds = explicitThreadId
    ? [explicitThreadId]
    : await findCodexThreadIdsForProject(projectPath, startedAt, endedAt);
  const logsPath = path.join(homedir(), ".codex", "logs_2.sqlite");
  const rows = await queryCodexUsageLogs(logsPath, startedAt, endedAt, projectPath, threadIds);

  const byTurn = new Map<string, CodexUsageLogRow[]>();
  for (const row of rows) {
    const turnId = row.turnId;
    if (!turnId) continue;
    if (expectedTurnId && turnId !== expectedTurnId) continue;
    const values = byTurn.get(turnId) ?? [];
    values.push(row);
    byTurn.set(turnId, values);
  }

  const turnFinals = [...byTurn.entries()]
    .map(([turnId, values]) => {
      values.sort((a, b) => a.id - b.id);
      const first = values[0];
      const final = values[values.length - 1];
      const total = numberFromPattern(final.body, /total_usage_tokens=(\d+)/);
      return { turnId, first, final, total };
    })
    .filter((item) => item.total > 0);

  if (turnFinals.length === 0) return [];

  const allThreadRows = await queryCodexUsageLogs(
    logsPath,
    new Date(startedAt.getTime() - 24 * 60 * 60 * 1000),
    endedAt,
    projectPath,
    threadIds
  );

  return turnFinals.map((item) => {
    const previousFinal = findPreviousCodexTotal(allThreadRows, item.first.id, item.turnId, item.final.threadId);
    const increment = previousFinal > 0 ? Math.max(item.total - previousFinal, 0) : item.total;
    const timestamp = new Date(item.final.ts * 1000);
    const modelName = item.final.modelName ?? round.model_name;

    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: increment || item.total,
      sourcePath: logsPath,
      sourceEventId: String(item.final.id),
      conversationId: item.final.threadId ?? threadIds[0],
      turnId: item.turnId,
      modelName,
      startedAt: timestamp,
      endedAt: timestamp,
      rawEvent: {
        id: item.final.id,
        ts: item.final.ts,
        threadId: item.final.threadId,
        turnId: item.turnId,
        modelName,
        totalUsageTokens: item.total,
        previousTotalUsageTokens: previousFinal,
        body: item.final.body.slice(0, 1000)
      },
      note: increment > 0
        ? "Codex token usage derived from cumulative total delta"
        : "Codex cumulative total only; no previous total found",
      matchQuality: expectedTurnId ? "turn_id" : "time_window"
    };
  });
}

async function findCodexRolloutCandidates(round: RoundRow, projectPath?: string): Promise<RoundCandidate[]> {
  const metadata = parseMetadata(round.metadata_json);
  const expectedTurnId = stringValue(metadata.turnId);
  const startedAt = toDate(round.started_at);
  const endedAt = toDate(round.ended_at);
  const files = await findCodexRolloutFiles();
  const candidates: RoundCandidate[] = [];

  for (const file of files) {
    let lineNumber = 0;
    let activeTurn: CodexRolloutTurn | null = null;
    let previousUsage: CodexTokenUsageSnapshot | undefined;

    for await (const event of readJsonLines(file)) {
      lineNumber += 1;
      if (!isObject(event) || !isObject(event.payload)) continue;

      const timestamp = new Date(String(event.timestamp ?? ""));
      const payload = event.payload;
      const payloadType = stringValue(payload.type);

      if (event.type === "event_msg" && payloadType === "task_started") {
        const turnId = stringValue(payload.turn_id);
        if (!turnId) continue;
        activeTurn = {
          turnId,
          startedAt: timestamp,
          baselineUsage: previousUsage,
          tokenEvents: []
        };
        continue;
      }

      if (event.type === "turn_context" && activeTurn) {
        const turnId = stringValue(payload.turn_id);
        if (!turnId || turnId !== activeTurn.turnId) continue;
        activeTurn.cwd = stringValue(payload.cwd);
        activeTurn.modelName = stringValue(payload.model);
        continue;
      }

      if (event.type === "event_msg" && payloadType === "token_count") {
        const usage = parseCodexTokenUsageSnapshot(payload.info);
        if (usage) {
          if (activeTurn) {
            activeTurn.tokenEvents.push({ lineNumber, timestamp, usage });
          }
          previousUsage = usage;
        }
        continue;
      }

      if (event.type === "event_msg" && payloadType === "mcp_tool_call_end" && activeTurn) {
        const callId = stringValue(payload.call_id);
        if (!callId || !isCodexRecordToolResult(payload, round)) continue;
        activeTurn.recordCall = { callId, lineNumber };
        continue;
      }

      if (event.type === "event_msg" && payloadType === "task_complete" && activeTurn) {
        const completedTurnId = stringValue(payload.turn_id);
        if (!completedTurnId || completedTurnId !== activeTurn.turnId) continue;

        activeTurn.completedAt = timestamp;
        const turnMatches = !expectedTurnId || activeTurn.turnId === expectedTurnId;
        const hasRecordMatch = Boolean(activeTurn.recordCall);
        const timeWindowMatch = !expectedTurnId
          && !hasRecordMatch
          && turnsOverlap(activeTurn.startedAt, activeTurn.completedAt, startedAt, endedAt, 90_000);
        if (turnMatches && (hasRecordMatch || expectedTurnId || timeWindowMatch) && (!projectPath || isSameOrChildPath(activeTurn.cwd, projectPath))) {
          const matchQuality = hasRecordMatch ? "exact_tool_call" : expectedTurnId ? "turn_id" : "time_window";
          const candidate = codexRolloutTurnToCandidate(
            file,
            activeTurn,
            round,
            matchQuality
          );
          if (candidate) candidates.push(candidate);
        }
        activeTurn = null;
      }
    }
  }

  return candidates;
}

async function findCodexRolloutFiles(): Promise<string[]> {
  const roots = [
    path.join(homedir(), ".codex", "sessions"),
    path.join(homedir(), ".codex", "archived_sessions")
  ];
  const files: string[] = [];
  for (const root of roots) {
    files.push(...await walkFiles(root, ".jsonl"));
  }
  return files;
}

function parseCodexTokenUsageSnapshot(value: unknown): CodexTokenUsageSnapshot | null {
  if (!isObject(value) || !isObject(value.total_token_usage)) return null;
  const usage = value.total_token_usage;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  if (totalTokens <= 0) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: numberValue(usage.cached_input_tokens),
    reasoningOutputTokens: numberValue(usage.reasoning_output_tokens)
  };
}

function isCodexRecordToolResult(payload: Record<string, unknown>, round: RoundRow): boolean {
  if (!isObject(payload.invocation)) return false;
  if (payload.invocation.server !== "ai-coding-stats") return false;
  if (payload.invocation.tool !== "record_ai_coding_round") return false;

  if (isObject(payload.result)) {
    const resultId = extractCodexRecordResultId(payload.result);
    if (resultId === round.id) return true;
  }

  if (isObject(payload.invocation.arguments)) {
    const args = payload.invocation.arguments;
    if (args.conversationId !== round.conversation_id) return false;
    const inputStartedAt = stringValue(args.startedAt);
    const inputEndedAt = stringValue(args.endedAt);
    if (inputStartedAt && inputEndedAt) {
      return sameMysqlDateTime(inputStartedAt, round.started_at)
        && sameMysqlDateTime(inputEndedAt, round.ended_at);
    }
  }

  return false;
}

function extractCodexRecordResultId(result: Record<string, unknown>): number | null {
  const ok = isObject(result.Ok) ? result.Ok : null;
  if (!ok) return null;

  if (isObject(ok.structuredContent)) {
    const id = numberValue(ok.structuredContent.id);
    if (id > 0) return id;
  }

  if (Array.isArray(ok.content)) {
    for (const item of ok.content) {
      if (!isObject(item) || item.type !== "text") continue;
      const text = stringValue(item.text);
      if (!text) continue;
      const parsed = parseJsonObject(text);
      const id = numberValue(parsed?.id);
      if (id > 0) return id;
    }
  }

  return null;
}

function codexRolloutTurnToCandidate(
  file: string,
  turn: CodexRolloutTurn,
  round: RoundRow,
  matchQuality: "exact_tool_call" | "turn_id" | "time_window" = "exact_tool_call"
): RoundCandidate | null {
  const finalEvent = turn.tokenEvents.at(-1);
  if (!finalEvent) return null;

  const baseline = turn.baselineUsage ?? turn.tokenEvents[0]?.usage;
  const totalTokens = Math.max(finalEvent.usage.totalTokens - (baseline?.totalTokens ?? 0), 0);
  if (totalTokens <= 0) return null;

  const inputTokens = Math.max(finalEvent.usage.inputTokens - (baseline?.inputTokens ?? 0), 0);
  const outputTokens = Math.max(finalEvent.usage.outputTokens - (baseline?.outputTokens ?? 0), 0);
  const cachedInputTokens = Math.max(finalEvent.usage.cachedInputTokens - (baseline?.cachedInputTokens ?? 0), 0);
  const reasoningOutputTokens = Math.max(finalEvent.usage.reasoningOutputTokens - (baseline?.reasoningOutputTokens ?? 0), 0);
  const threadId = extractCodexThreadIdFromRolloutPath(file);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    sourcePath: file,
    sourceEventId: `tool-call:${turn.recordCall?.callId ?? turn.turnId}`,
    conversationId: threadId,
    turnId: turn.turnId,
    modelName: turn.modelName ?? round.model_name,
    startedAt: turn.startedAt,
    endedAt: turn.completedAt ?? finalEvent.timestamp,
    rawEvent: {
      threadId,
      turnId: turn.turnId,
      cwd: turn.cwd,
      modelName: turn.modelName,
      recordCallId: turn.recordCall?.callId,
      recordCallLine: turn.recordCall?.lineNumber,
      tokenEventCount: turn.tokenEvents.length,
      baselineTotalTokens: baseline?.totalTokens ?? 0,
      finalTotalTokens: finalEvent.usage.totalTokens,
      cachedInputTokens,
      reasoningOutputTokens,
      finalTokenEventLine: finalEvent.lineNumber
    },
    note: codexRolloutNote(matchQuality),
    matchQuality,
    matchCallId: turn.recordCall?.callId
  };
}

function codexRolloutNote(matchQuality: "exact_tool_call" | "turn_id" | "time_window"): string {
  if (matchQuality === "exact_tool_call") {
    return "Codex usage matched by rollout MCP record tool call; token_count cumulative delta";
  }
  if (matchQuality === "turn_id") {
    return "Codex usage matched by rollout turnId; token_count cumulative delta";
  }
  return "Codex usage matched by rollout time window; token_count cumulative delta";
}

function extractCodexThreadIdFromRolloutPath(filePath: string): string | undefined {
  const match = path.basename(filePath).match(/rollout-.+?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
  return match?.[1];
}

async function queryCodexUsageLogs(
  logsPath: string,
  startedAt: Date,
  endedAt: Date,
  projectPath?: string,
  threadIds?: string[]
): Promise<CodexUsageLogRow[]> {
  const threadCondition = threadIds && threadIds.length > 0
    ? `AND (${threadIds.map((threadId) => (
        `feedback_log_body LIKE '%thread.id=${escapeSqlLike(threadId)}%' OR ` +
        `feedback_log_body LIKE '%thread_id=${escapeSqlLike(threadId)}%'`
      )).join(" OR ")})`
    : "";
  const sqliteRows = await runSqliteQuery(logsPath, `
    SELECT id, ts, substr(feedback_log_body, 1, 4000) AS feedback_log_body
    FROM logs
    WHERE target = 'codex_core::session::turn'
      AND feedback_log_body LIKE '%:run_turn: post sampling token usage%'
      AND ts >= ${Math.floor((startedAt.getTime() - 15 * 60 * 1000) / 1000)}
      AND ts <= ${Math.ceil((endedAt.getTime() + 15 * 60 * 1000) / 1000)}
      ${threadCondition}
      ${projectPath && (!threadIds || threadIds.length === 0) ? `AND (feedback_log_body LIKE '%cwd=${escapeSqlLike(projectPath)}%' OR feedback_log_body LIKE '%cwd="${escapeSqlLike(projectPath)}"%')` : ""}
    ORDER BY id ASC
  `);

  return sqliteRows
    .map((row) => {
      const body = String(row.feedback_log_body ?? "");
      return {
        id: Number(row.id),
        ts: Number(row.ts),
        body,
        threadId: extractPattern(body, /(?:thread\.id|thread_id)=([0-9a-f-]+)/),
        turnId: extractPattern(body, /turn_id=([0-9a-f-]+)/) ?? extractPattern(body, /turn\.id=([0-9a-f-]+)/),
        modelName: extractCodexModelName(body)
      };
    })
    .filter((row) => row.body.length > 0);
}

async function runSqliteQuery(filePath: string, sql: string): Promise<Array<Record<string, unknown>>> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("sqlite3", ["-json", filePath, sql], {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function findCodexThreadIdsForProject(projectPath: string | undefined, startedAt: Date, endedAt: Date): Promise<string[]> {
  if (!projectPath) return [];
  const statePath = path.join(homedir(), ".codex", "state_5.sqlite");
  const startedAtMs = startedAt.getTime();
  const endedAtMs = endedAt.getTime();
  const lowerBoundMs = startedAtMs - 60 * 60 * 1000;
  const upperBoundMs = endedAtMs + 60 * 60 * 1000;
  const rows = await runSqliteQuery(statePath, `
    SELECT id
    FROM threads
      WHERE cwd = '${projectPath.replaceAll("'", "''")}'
      AND COALESCE(updated_at_ms, updated_at * 1000) >= ${lowerBoundMs}
      AND COALESCE(created_at_ms, created_at * 1000) <= ${upperBoundMs}
    ORDER BY ABS(COALESCE(updated_at_ms, updated_at * 1000) - ${endedAtMs}) ASC
    LIMIT 20
  `).catch(() => []);
  return rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
}

function findPreviousCodexTotal(rows: CodexUsageLogRow[], beforeId: number, currentTurnId: string, currentThreadId?: string): number {
  const previousRows = rows
    .filter((row) => row.id < beforeId)
    .filter((row) => row.turnId !== currentTurnId)
    .filter((row) => !currentThreadId || row.threadId === currentThreadId)
    .sort((a, b) => b.id - a.id);
  for (const row of previousRows) {
    const total = numberFromPattern(row.body, /total_usage_tokens=(\d+)/);
    if (total > 0) return total;
  }
  return 0;
}

async function applyCandidate(
  roundId: number,
  client: ClientName,
  candidate: RoundCandidate,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  const existing = await localStorage.getRound(roundId);
  if (!existing) {
    throw new Error(`Round ${roundId} not found`);
  }

  const tokenSource = client === "claude-code" ? "claude_jsonl" : "codex_log";
  const now = new Date().toISOString();
  const updated: localStorage.Round = {
    ...existing,
    inputTokens: candidate.inputTokens,
    outputTokens: candidate.outputTokens,
    totalTokens: candidate.totalTokens,
    modelName: candidate.modelName ?? existing.modelName,
    tokenSource,
    tokenMatchQuality: candidate.matchQuality ?? null,
    tokenSyncStatus: "synced",
    tokenSyncedAt: now,
    tokenSyncNote: candidate.note ?? null,
  };
  await localStorage.updateRound(updated);

  await localStorage.createTokenUsageEvent({
    roundId,
    client,
    sourcePath: candidate.sourcePath,
    sourceEventId: candidate.sourceEventId,
    conversationId: candidate.conversationId ?? null,
    turnId: candidate.turnId ?? null,
    modelName: candidate.modelName ?? null,
    startedAt: candidate.startedAt ? candidate.startedAt.toISOString() : null,
    endedAt: candidate.endedAt ? candidate.endedAt.toISOString() : null,
    inputTokens: candidate.inputTokens,
    outputTokens: candidate.outputTokens,
    totalTokens: candidate.totalTokens,
    matchQuality: candidate.matchQuality ?? null,
    rawEvent: candidate.rawEvent ?? null,
  });
}

async function markRound(
  roundId: number,
  status: Exclude<SyncStatus, "synced">,
  note: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  const existing = await localStorage.getRound(roundId);
  if (!existing) {
    return;
  }

  const updated: localStorage.Round = {
    ...existing,
    tokenMatchQuality: null,
    tokenSyncStatus: status,
    tokenSyncNote: note.slice(0, 512),
    tokenSyncedAt: new Date().toISOString(),
  };
  await localStorage.updateRound(updated);
}

async function findClaudeProjectFiles(projectPath?: string): Promise<string[]> {
  const root = path.join(homedir(), ".claude", "projects");
  const files = await walkFiles(root, ".jsonl");
  if (!projectPath) return files;

  const encoded = projectPath.replaceAll("/", "-");
  const projectFiles = files.filter((file) => file.includes(encoded));
  return projectFiles.length > 0 ? projectFiles : files;
}

async function walkFiles(root: string, suffix: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function* readJsonLines(filePath: string): AsyncGenerator<unknown> {
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // Ignore malformed historical log lines.
    }
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--client" && next) {
      if (next !== "codex" && next !== "claude-code") {
        throw new Error("--client must be codex or claude-code");
      }
      args.client = next;
      index += 1;
    } else if (arg === "--round-id" && next) {
      args.roundId = Number(next);
      index += 1;
    } else if (arg === "--project" && next) {
      args.project = next;
      index += 1;
    } else if (arg === "--since" && next) {
      args.since = next;
      index += 1;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }
  return args;
}

function parseMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {};
  return parseJsonObject(metadataJson) ?? {};
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeClient(value: unknown): ClientName | null {
  if (value === "codex") return "codex";
  if (value === "claude-code") return "claude-code";
  return null;
}

function projectFromConversation(conversationId: string): string | undefined {
  const match = conversationId.match(/^(?:codex|claude):(.+?)(?::[^/].*)?$/);
  return match?.[1];
}

function extractCodexThreadId(conversationId: string): string | undefined {
  const match = conversationId.match(/^codex:([0-9a-f-]{36})$/);
  return match?.[1];
}

function isWithinWindow(value: Date, startedAt: Date, endedAt: Date, bufferMs: number): boolean {
  const time = value.getTime();
  return time >= startedAt.getTime() - bufferMs && time <= endedAt.getTime() + bufferMs;
}

function turnsOverlap(turnStartedAt: Date, turnEndedAt: Date | undefined, roundStartedAt: Date, roundEndedAt: Date, bufferMs: number): boolean {
  const turnStart = turnStartedAt.getTime();
  const turnEnd = (turnEndedAt ?? turnStartedAt).getTime();
  const roundStart = roundStartedAt.getTime() - bufferMs;
  const roundEnd = roundEndedAt.getTime() + bufferMs;
  return turnStart <= roundEnd && turnEnd >= roundStart;
}

function isSameOrChildPath(value: string | undefined, parent: string | undefined): boolean {
  if (!value || !parent) return false;
  const normalizedValue = normalizeComparablePath(path.resolve(value));
  const normalizedParent = normalizeComparablePath(path.resolve(parent));
  return normalizedValue === normalizedParent || normalizedValue.startsWith(`${normalizedParent}${path.sep}`);
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replaceAll("\\", path.sep).replaceAll("/", path.sep);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameProjectPath(left: string, right: string): boolean {
  return normalizeComparablePath(path.resolve(left)) === normalizeComparablePath(path.resolve(right));
}

function dedupeCandidates(candidates: RoundCandidate[]): RoundCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.matchCallId
      ? `tool-call:${candidate.matchCallId}`
      : `${candidate.sourcePath}:${candidate.sourceEventId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPattern(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

function numberFromPattern(value: string, pattern: RegExp): number {
  const number = Number(extractPattern(value, pattern) ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function extractCodexModelName(value: string): string | undefined {
  return extractPattern(value, /\bmodel=([^}: ]+)/)
    ?? extractPattern(value, /\bmodel_name=([^}: ]+)/)
    ?? extractPattern(value, /"model"\s*:\s*"([^"]+)"/);
}

function escapeSqlLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function eventHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function slimRawEvent(event: Record<string, unknown>): Record<string, unknown> {
  return {
    uuid: event.uuid,
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    cwd: event.cwd,
    message: isObject(event.message)
      ? {
          model: event.message.model,
          usage: event.message.usage
        }
      : undefined
  };
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function toMysqlDateTime(value: string): string {
  return new Date(value).toISOString().slice(0, 23).replace("T", " ");
}

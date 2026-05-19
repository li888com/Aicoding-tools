import { AddressInfo } from "node:net";
import { closePool, recordRound } from "../src/database.js";
import { createDashboardServer } from "../src/dashboard-server.js";
import * as localStorage from "../src/local-storage.js";

const username = process.env.DASHBOARD_USERNAME ?? "admin";
const password = process.env.DASHBOARD_PASSWORD ?? "change-me";
const testRequirementId = 900_000_000 + Math.floor(Date.now() % 1_000_000);
const testConversationId = `dashboard-api-${Date.now()}`;
let testRoundId: number | undefined;

const server = createDashboardServer({
  host: "127.0.0.1",
  port: 0,
  username,
  password,
  sessionSecret: "dashboard-api-test-secret",
  sessionTtlMs: 60 * 60 * 1000
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const unauthorized = await fetch(`${baseUrl}/api/summary`);
  if (unauthorized.status !== 401) {
    throw new Error(`Expected unauthorized API status 401, got ${unauthorized.status}`);
  }

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  if (!login.ok) {
    throw new Error(`Login failed with status ${login.status}`);
  }

  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Login did not return a session cookie");
  }

  const pages = [
    "/",
    "/requirements.html",
    "/models.html",
    "/timeline.html",
    "/rounds.html",
    "/requirement-maintenance.html",
    "/corrections.html",
    "/local-logs.html"
  ];

  for (const page of pages) {
    const response = await fetch(`${baseUrl}${page}`, {
      headers: {
        Cookie: cookie
      }
    });

    if (!response.ok) {
      throw new Error(`${page} failed with status ${response.status}: ${await response.text()}`);
    }

    const html = await response.text();
    if (!html.includes("page-nav") || !html.includes("/app.js")) {
      throw new Error(`${page} did not return the dashboard shell`);
    }
  }

  const endpoints = [
    "/api/summary",
    "/api/requirements",
    "/api/requirement-records",
    "/api/models",
    "/api/timeline",
    "/api/rounds",
    "/api/filters",
    "/api/corrections?limit=5",
    "/api/sync-status",
    "/api/local-logs/files?client=codex&limit=5",
    "/api/local-logs/files?client=claude-code&limit=5",
    "/api/summary?includeReverted=true",
    "/api/rounds?requirementId=null&includeReverted=true"
  ];

  const results: Record<string, unknown> = {};
  for (const endpoint of endpoints) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      headers: {
        Cookie: cookie
      }
    });

    if (!response.ok) {
      throw new Error(`${endpoint} failed with status ${response.status}: ${await response.text()}`);
    }

    results[endpoint] = await response.json();
  }

  const summary = results["/api/summary"] as Record<string, unknown>;
  for (const key of [
    "tokenPendingRounds",
    "tokenNotFoundRounds",
    "tokenAmbiguousRounds",
    "tokenFailedRounds",
    "tokenCompletenessRate",
    "lastTokenSyncedAt",
    "lastOnlineSyncedAt"
  ]) {
    if (!(key in summary)) {
      throw new Error(`/api/summary is missing ${key}`);
    }
  }

  const filters = results["/api/filters"] as Record<string, unknown>;
  if (!Array.isArray(filters.tokenSyncStatuses)) {
    throw new Error("/api/filters is missing tokenSyncStatuses");
  }

  const syncStatus = results["/api/sync-status"] as Record<string, unknown>;
  if (!("running" in syncStatus) || !("state" in syncStatus)) {
    throw new Error(`/api/sync-status returned unexpected payload: ${JSON.stringify(syncStatus)}`);
  }
  const syncState = syncStatus.state as Record<string, unknown> | null;
  if (syncState && !("lastTokenSyncSince" in syncState)) {
    throw new Error(`/api/sync-status state is missing lastTokenSyncSince: ${JSON.stringify(syncStatus)}`);
  }

  const saved = await fetch(`${baseUrl}/api/requirement-records/${testRequirementId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      title: "Dashboard API verification",
      projectName: "ai-coding-stats",
      gpmNumber: "GPM-VERIFY",
      status: "active",
      description: "temporary verification requirement"
    })
  });

  if (!saved.ok) {
    throw new Error(`Requirement save failed with status ${saved.status}: ${await saved.text()}`);
  }

  const savedBody = await saved.json();
  if (
    savedBody.requirementId !== testRequirementId ||
    savedBody.title !== "Dashboard API verification" ||
    savedBody.projectName !== "ai-coding-stats" ||
    savedBody.gpmNumber !== "GPM-VERIFY"
  ) {
    throw new Error(`Unexpected saved requirement payload: ${JSON.stringify(savedBody)}`);
  }

  testRoundId = (await recordRound({
    conversationId: testConversationId,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date(Date.now() - 30_000).toISOString(),
    modelName: "dashboard-verify-model",
    promptText: `#${testRequirementId} dashboard temporary round`,
    filesChanged: 1,
    linesAdded: 2,
    linesDeleted: 1,
    inputTokens: 10,
    outputTokens: 5,
    metadata: {
      client: "dashboard-test"
    }
  })).id;

  const editedRound = await fetch(`${baseUrl}/api/rounds/${testRoundId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      requirementId: testRequirementId,
      modelName: "dashboard-verify-model-edited",
      startedAt: new Date(Date.now() - 90_000).toISOString(),
      endedAt: new Date(Date.now() - 30_000).toISOString(),
      promptText: "edited dashboard temporary round",
      filesChanged: 2,
      linesAdded: 4,
      linesDeleted: 3,
      codeLinesChanged: 7,
      inputTokens: 20,
      outputTokens: 8,
      totalTokens: 28,
      client: "dashboard-test-edited"
    })
  });

  if (!editedRound.ok) {
    throw new Error(`Round edit failed with status ${editedRound.status}: ${await editedRound.text()}`);
  }

  const editedRoundBody = await editedRound.json();
  if (
    editedRoundBody.modelName !== "dashboard-verify-model-edited" ||
    editedRoundBody.codeLinesChanged !== 7 ||
    editedRoundBody.totalTokens !== 28 ||
    editedRoundBody.client !== "dashboard-test-edited"
  ) {
    throw new Error(`Unexpected edited round payload: ${JSON.stringify(editedRoundBody)}`);
  }

  const createdCandidates = await localStorage.replaceTokenUsageCandidates(testRoundId, "codex", [
    {
      roundId: testRoundId,
      client: "codex",
      sourcePath: "verify-dashboard-api.jsonl",
      sourceEventId: `candidate-${testRoundId}`,
      conversationId: "verify-thread",
      turnId: "verify-turn",
      modelName: "dashboard-verify-model-edited",
      startedAt: new Date(Date.now() - 80_000).toISOString(),
      endedAt: new Date(Date.now() - 20_000).toISOString(),
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      matchQuality: "time_window",
      note: "temporary dashboard candidate",
      rawEvent: {
        verify: true
      }
    }
  ]);

  const candidateList = await fetch(`${baseUrl}/api/rounds/${testRoundId}/token-candidates`, {
    headers: {
      Cookie: cookie
    }
  });

  if (!candidateList.ok) {
    throw new Error(`Token candidate list failed with status ${candidateList.status}: ${await candidateList.text()}`);
  }

  const candidateListBody = await candidateList.json();
  if (!Array.isArray(candidateListBody.candidates) || candidateListBody.candidates.length === 0) {
    throw new Error(`Unexpected token candidate payload: ${JSON.stringify(candidateListBody)}`);
  }

  const bindCandidate = await fetch(
    `${baseUrl}/api/rounds/${testRoundId}/token-candidates/${createdCandidates[0].id}/bind`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie
      },
      body: JSON.stringify({
        actor: "dashboard-api-test",
        reason: "verify manual binding"
      })
    }
  );

  if (!bindCandidate.ok) {
    throw new Error(`Token candidate bind failed with status ${bindCandidate.status}: ${await bindCandidate.text()}`);
  }

  const bindCandidateBody = await bindCandidate.json();
  if (
    bindCandidateBody.tokenSyncStatus !== "synced" ||
    bindCandidateBody.tokenMatchQuality !== "manual" ||
    bindCandidateBody.totalTokens !== 125
  ) {
    throw new Error(`Unexpected token candidate bind payload: ${JSON.stringify(bindCandidateBody)}`);
  }

  const resetToken = await fetch(`${baseUrl}/api/rounds/${testRoundId}/token-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      actor: "dashboard-api-test",
      reason: "verify token reset"
    })
  });

  if (!resetToken.ok) {
    throw new Error(`Token reset failed with status ${resetToken.status}: ${await resetToken.text()}`);
  }

  const resetTokenBody = await resetToken.json();
  if (resetTokenBody.tokenSyncStatus !== "pending") {
    throw new Error(`Unexpected token reset payload: ${JSON.stringify(resetTokenBody)}`);
  }

  const retryTokenSync = await fetch(`${baseUrl}/api/rounds/${testRoundId}/token-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      actor: "dashboard-api-test",
      reason: "verify token sync retry",
      projectPath: process.cwd()
    })
  });

  if (!retryTokenSync.ok) {
    throw new Error(`Token sync retry failed with status ${retryTokenSync.status}: ${await retryTokenSync.text()}`);
  }

  const retryTokenSyncBody = await retryTokenSync.json();
  if (!["synced", "not_found", "ambiguous", "failed", "pending"].includes(String(retryTokenSyncBody.tokenSyncStatus))) {
    throw new Error(`Unexpected token sync retry payload: ${JSON.stringify(retryTokenSyncBody)}`);
  }

  const ignoreRound = await fetch(`${baseUrl}/api/rounds/${testRoundId}/ignore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      actor: "dashboard-api-test",
      reason: "verify round ignore"
    })
  });

  if (!ignoreRound.ok) {
    throw new Error(`Round ignore failed with status ${ignoreRound.status}: ${await ignoreRound.text()}`);
  }

  const ignoredRounds = await fetch(`${baseUrl}/api/rounds?includeIgnored=true`, {
    headers: {
      Cookie: cookie
    }
  });
  if (!ignoredRounds.ok) {
    throw new Error(`Ignored round list failed with status ${ignoredRounds.status}: ${await ignoredRounds.text()}`);
  }
  const ignoredRoundsBody = await ignoredRounds.json() as Array<Record<string, unknown>>;
  const ignoredRound = ignoredRoundsBody.find((round) => round.id === testRoundId);
  if (!ignoredRound || ignoredRound.isIgnored !== true) {
    throw new Error(`Ignored round was not visible with includeIgnored=true: ${JSON.stringify(ignoredRoundsBody)}`);
  }

  const restoreRound = await fetch(`${baseUrl}/api/rounds/${testRoundId}/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({
      actor: "dashboard-api-test",
      reason: "verify round restore"
    })
  });

  if (!restoreRound.ok) {
    throw new Error(`Round restore failed with status ${restoreRound.status}: ${await restoreRound.text()}`);
  }

  const deletedRound = await fetch(`${baseUrl}/api/rounds/${testRoundId}`, {
    method: "DELETE",
    headers: {
      Cookie: cookie
    }
  });

  if (!deletedRound.ok) {
    throw new Error(`Round delete failed with status ${deletedRound.status}: ${await deletedRound.text()}`);
  }
  testRoundId = undefined;

  const deletedRequirement = await fetch(`${baseUrl}/api/requirement-records/${testRequirementId}`, {
    method: "DELETE",
    headers: {
      Cookie: cookie
    }
  });

  if (!deletedRequirement.ok) {
    throw new Error(`Requirement delete failed with status ${deletedRequirement.status}: ${await deletedRequirement.text()}`);
  }

  console.log(JSON.stringify({ ok: true, pages, endpoints: Object.keys(results) }, null, 2));
} finally {
  if (testRoundId !== undefined) {
    await localStorage.deleteTokenUsageEventsByRound(testRoundId).catch(() => undefined);
    await localStorage.deleteTokenUsageCandidatesByRound(testRoundId).catch(() => undefined);
    await localStorage.deleteAiCodingCorrectionsByRound(testRoundId).catch(() => undefined);
    await localStorage.deleteRound(testRoundId).catch(() => undefined);
  }
  await localStorage.deleteConversation(testConversationId).catch(() => undefined);
  await localStorage.deleteRequirement(testRequirementId).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
}

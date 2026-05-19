import { AddressInfo } from "node:net";
import { createDashboardServer } from "../src/dashboard-server.js";

const username = process.env.DASHBOARD_USERNAME ?? "admin";
const password = process.env.DASHBOARD_PASSWORD ?? "change-me";
const remoteBaseUrl = (
  process.env.AI_CODING_DASHBOARD_API_BASE_URL ?? "http://localhost:9906/api/ai-coding/dashboard"
).replace(/\/+$/, "");

const fileCategoryKeys = [
  "sourceLinesChanged",
  "docLinesChanged",
  "configLinesChanged",
  "testLinesChanged",
  "generatedLinesChanged",
  "otherLinesChanged",
] as const;

const server = createDashboardServer({
  host: "127.0.0.1",
  port: 0,
  username,
  password,
  sessionSecret: "remote-dashboard-api-test-secret",
  sessionTtlMs: 60 * 60 * 1000,
  dashboardApiBaseUrl: remoteBaseUrl,
  dashboardApiTimeoutMs: Number(process.env.AI_CODING_DASHBOARD_API_TIMEOUT_MS ?? 5000),
  dashboardApiFallbackLocal: false,
});

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const login = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!login.ok || !cookie) {
    throw new Error(`Login failed with status ${login.status}`);
  }

  const results = {
    filters: await getJson(`${baseUrl}/api/filters`, cookie),
    summary: await getJson(`${baseUrl}/api/summary`, cookie),
    requirements: await getJson(`${baseUrl}/api/requirements`, cookie),
    models: await getJson(`${baseUrl}/api/models`, cookie),
    timeline: await getJson(`${baseUrl}/api/timeline`, cookie),
    rounds: await getJson(`${baseUrl}/api/rounds`, cookie),
  };

  assertPlainPayload("/api/filters", results.filters);
  assertPlainPayload("/api/summary", results.summary);
  assertPlainPayload("/api/requirements", results.requirements);
  assertPlainPayload("/api/models", results.models);
  assertPlainPayload("/api/timeline", results.timeline);
  assertPlainPayload("/api/rounds", results.rounds);

  const filters = assertRecord("/api/filters", results.filters);
  assertArray("/api/filters.models", filters.models);
  assertArray("/api/filters.requirements", filters.requirements);
  assertArray("/api/filters.clients", filters.clients);
  assertArray("/api/filters.tokenSyncStatuses", filters.tokenSyncStatuses);

  const summary = assertRecord("/api/summary", results.summary);
  for (const key of [
    "roundCount",
    "totalTokens",
    "tokenPendingRounds",
    "tokenNotFoundRounds",
    "tokenAmbiguousRounds",
    "tokenFailedRounds",
    "tokenCompletenessRate",
  ]) {
    assertNumberLike(`/api/summary.${key}`, summary[key]);
  }
  assertFileCategorySummary("/api/summary.fileCategorySummary", summary.fileCategorySummary);

  const requirements = assertArray("/api/requirements", results.requirements);
  if (requirements.length > 0) {
    const requirement = assertRecord("/api/requirements[0]", requirements[0]);
    assertNumberLike("/api/requirements[0].tokenCompletenessRate", requirement.tokenCompletenessRate);
    assertFileCategorySummary("/api/requirements[0].fileCategorySummary", requirement.fileCategorySummary);
  }

  assertArray("/api/models", results.models);
  assertArray("/api/timeline", results.timeline);
  assertArray("/api/rounds", results.rounds);

  console.log(JSON.stringify({
    ok: true,
    remoteBaseUrl,
    fallbackLocal: false,
    summary: {
      roundCount: Number(summary.roundCount),
      totalTokens: Number(summary.totalTokens),
      tokenCompletenessRate: Number(summary.tokenCompletenessRate),
    },
    counts: {
      requirements: requirements.length,
      models: (results.models as unknown[]).length,
      timeline: (results.timeline as unknown[]).length,
      rounds: (results.rounds as unknown[]).length,
    },
  }, null, 2));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function getJson(url: string, cookie: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Cookie: cookie,
    },
  });
  if (!response.ok) {
    throw new Error(`${url} failed with status ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function assertPlainPayload(name: string, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if ("data" in record || "code" in record || "msg" in record) {
    throw new Error(`${name} was not unwrapped by dashboard proxy: ${JSON.stringify(value)}`);
  }
}

function assertRecord(name: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} should be an object: ${JSON.stringify(value)}`);
  }

  return value as Record<string, unknown>;
}

function assertArray(name: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} should be an array: ${JSON.stringify(value)}`);
  }

  return value;
}

function assertNumberLike(name: string, value: unknown): void {
  const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${name} should be a number-like value: ${JSON.stringify(value)}`);
  }
}

function assertFileCategorySummary(name: string, value: unknown): void {
  const summary = assertRecord(name, value);
  for (const key of fileCategoryKeys) {
    assertNumberLike(`${name}.${key}`, summary[key]);
  }
}

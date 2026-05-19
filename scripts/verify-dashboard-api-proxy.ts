import { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createDashboardServer } from "../src/dashboard-server.js";

const username = process.env.DASHBOARD_USERNAME ?? "admin";
const password = process.env.DASHBOARD_PASSWORD ?? "change-me";

let proxiedPath = "";
const proxiedPaths: string[] = [];
const remoteServer = createServer((request, response) => {
  proxiedPath = request.url ?? "";
  proxiedPaths.push(proxiedPath);

  if (proxiedPath.startsWith("/api/ai-coding/dashboard/requirements")) {
    response.statusCode = 424;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "dependency_missing" }));
    return;
  }

  if (proxiedPath.startsWith("/api/ai-coding/dashboard/by-requirement")) {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
      code: 0,
      msg: null,
      data: [{
        requirementId: 555,
        title: "#555",
        roundCount: 1,
        totalTokens: "8000",
        tokenCompletenessRate: 0
      }],
      ok: true
    }));
    return;
  }

  if (proxiedPath.startsWith("/api/ai-coding/dashboard/summary")) {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({
      code: 0,
      msg: null,
      data: {
        requirementCount: 1,
        roundCount: 1,
        totalTokens: "8000",
        tokenMissingRounds: 0,
        tokenSyncedRounds: 1,
        codeLinesChanged: 150
      },
      ok: true
    }));
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    code: 0,
    msg: null,
    data: {
      models: ["proxy-model"],
      requirements: [],
      clients: ["codex"],
      tokenSyncStatuses: ["synced"]
    },
    ok: true
  }));
});

try {
  await new Promise<void>((resolve) => remoteServer.listen(0, "127.0.0.1", resolve));
  const remoteAddress = remoteServer.address() as AddressInfo;
  const dashboardServer = createDashboardServer({
    host: "127.0.0.1",
    port: 0,
    username,
    password,
    sessionSecret: "dashboard-api-proxy-test-secret",
    sessionTtlMs: 60 * 60 * 1000,
    dashboardApiBaseUrl: `http://127.0.0.1:${remoteAddress.port}/api/ai-coding/dashboard`,
    dashboardApiTimeoutMs: 1000,
    dashboardApiFallbackLocal: false
  });

  try {
    await new Promise<void>((resolve) => dashboardServer.listen(0, "127.0.0.1", resolve));
    const dashboardAddress = dashboardServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${dashboardAddress.port}`;

    const login = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!login.ok || !cookie) {
      throw new Error(`Login failed with status ${login.status}`);
    }

    const response = await fetch(`${baseUrl}/api/filters?client=codex`, {
      headers: {
        Cookie: cookie
      }
    });
    if (!response.ok) {
      throw new Error(`/api/filters failed with status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    if (!Array.isArray(payload.models) || payload.models[0] !== "proxy-model") {
      throw new Error(`Unexpected proxied payload: ${JSON.stringify(payload)}`);
    }
    if ("data" in payload || "code" in payload) {
      throw new Error(`Dashboard proxy did not unwrap API envelope: ${JSON.stringify(payload)}`);
    }

    if (proxiedPath !== "/api/ai-coding/dashboard/filters?client=codex") {
      throw new Error(`Unexpected proxied path: ${proxiedPath}`);
    }

    const requirementsResponse = await fetch(`${baseUrl}/api/requirements?model=gpt-5-codex`, {
      headers: {
        Cookie: cookie
      }
    });
    if (!requirementsResponse.ok) {
      throw new Error(`/api/requirements failed with status ${requirementsResponse.status}: ${await requirementsResponse.text()}`);
    }
    const requirements = await requirementsResponse.json() as Array<Record<string, unknown>>;
    if (
      requirements[0]?.requirementId !== 555 ||
      requirements[0]?.totalTokens !== "8000" ||
      requirements[0]?.tokenCompletenessRate !== 1
    ) {
      throw new Error(`Unexpected fallback requirements payload: ${JSON.stringify(requirements)}`);
    }

    const expectedFallbackPath = "/api/ai-coding/dashboard/by-requirement?model=gpt-5-codex";
    if (!proxiedPaths.includes(expectedFallbackPath)) {
      throw new Error(`Dashboard proxy did not try ${expectedFallbackPath}: ${JSON.stringify(proxiedPaths)}`);
    }

    const summaryResponse = await fetch(`${baseUrl}/api/summary`, {
      headers: {
        Cookie: cookie
      }
    });
    if (!summaryResponse.ok) {
      throw new Error(`/api/summary failed with status ${summaryResponse.status}: ${await summaryResponse.text()}`);
    }
    const summary = await summaryResponse.json() as Record<string, unknown>;
    if (
      summary.tokenPendingRounds !== 0 ||
      typeof summary.tokenCompletenessRate !== "number" ||
      !summary.fileCategorySummary
    ) {
      throw new Error(`Dashboard proxy did not normalize summary: ${JSON.stringify(summary)}`);
    }

    const syncStatusResponse = await fetch(`${baseUrl}/api/sync-status`, {
      headers: {
        Cookie: cookie
      }
    });
    if (!syncStatusResponse.ok) {
      throw new Error(`/api/sync-status should stay local, got ${syncStatusResponse.status}: ${await syncStatusResponse.text()}`);
    }
    const syncStatus = await syncStatusResponse.json() as Record<string, unknown>;
    if (!("state" in syncStatus) || proxiedPaths.some((path) => path.includes("/sync-status"))) {
      throw new Error(`/api/sync-status was unexpectedly proxied: ${JSON.stringify({ syncStatus, proxiedPaths })}`);
    }

    console.log(JSON.stringify({
      ok: true,
      proxiedPaths,
      models: payload.models
    }, null, 2));
  } finally {
    await new Promise<void>((resolve) => dashboardServer.close(() => resolve()));
  }
} finally {
  await new Promise<void>((resolve) => remoteServer.close(() => resolve()));
}

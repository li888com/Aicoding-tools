import "dotenv/config";

export type DashboardConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  sessionSecret: string;
  sessionTtlMs: number;
  dashboardApiBaseUrl: string;
  dashboardApiTimeoutMs: number;
  dashboardApiFallbackLocal: boolean;
};

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getDashboardConfig(): DashboardConfig {
  return {
    host: process.env.DASHBOARD_HOST ?? "127.0.0.1",
    port: readNumber("DASHBOARD_PORT", 8080),
    username: process.env.DASHBOARD_USERNAME ?? "admin",
    password: process.env.DASHBOARD_PASSWORD ?? "change-me",
    sessionSecret: process.env.DASHBOARD_SESSION_SECRET ?? "local-dev-dashboard-secret",
    sessionTtlMs: readNumber("DASHBOARD_SESSION_TTL_HOURS", 12) * 60 * 60 * 1000,
    dashboardApiBaseUrl: (process.env.AI_CODING_DASHBOARD_API_BASE_URL ?? "http://localhost:9906/api/ai-coding/dashboard").replace(/\/+$/, ""),
    dashboardApiTimeoutMs: readNumber("AI_CODING_DASHBOARD_API_TIMEOUT_MS", 2000),
    dashboardApiFallbackLocal: readBoolean("AI_CODING_DASHBOARD_API_FALLBACK_LOCAL", true)
  };
}

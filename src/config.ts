import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadDotenv();
loadDotenv({ path: resolve(moduleDir, "../.env") });

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
};

export type FeishuConfig = {
  appId: string;
  appSecret: string;
  baseUrl: string;
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

export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: readNumber("MYSQL_PORT", 3306),
    user: process.env.MYSQL_USER ?? "ai_coding",
    password: process.env.MYSQL_PASSWORD ?? "ai_coding_pass",
    database: process.env.MYSQL_DATABASE ?? "ai_coding_stats",
    connectionLimit: readNumber("MYSQL_CONNECTION_LIMIT", 10)
  };
}

export function getFeishuConfig(): FeishuConfig {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for Feishu document tools");
  }

  return {
    appId,
    appSecret,
    baseUrl: process.env.FEISHU_BASE_URL?.trim() || "https://open.feishu.cn"
  };
}

export type IpGuardConfig = {
  url: string;
  name: string;
  password: string;
};

export function getIpGuardConfig(): IpGuardConfig {
  return {
    url: process.env.IPGUARD_URL ?? "http://192.168.10.30:8095",
    name: process.env.IPGUARD_NAME ?? "ipguard-dify",
    password: process.env.IPGUARD_PASSWORD ?? "IPGUARD#dify202509",
  };
}

export type RequirementApiMode = "local" | "remote";

export type RequirementApiConfig = {
  mode: RequirementApiMode;
  baseUrl: string | null;
  token: string | null;
  timeoutMs: number;
};

export function getRequirementApiConfig(): RequirementApiConfig {
  const mode = (process.env.AI_CODING_REQUIREMENT_API_MODE?.trim() || "local").toLowerCase();
  if (mode !== "local" && mode !== "remote") {
    throw new Error("AI_CODING_REQUIREMENT_API_MODE must be local or remote");
  }

  return {
    mode,
    baseUrl: process.env.AI_CODING_REQUIREMENT_API_BASE_URL?.trim() || null,
    token: process.env.AI_CODING_REQUIREMENT_API_TOKEN?.trim() || null,
    timeoutMs: readNumber("AI_CODING_REQUIREMENT_API_TIMEOUT_MS", 10000),
  };
}

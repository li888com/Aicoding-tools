import { getFeishuConfig } from "../../config.js";
import type { FeishuConfig } from "./types.js";

type FeishuApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type TenantAccessTokenResponse = {
  tenant_access_token: string;
  expire: number;
};

export class FeishuClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: FeishuConfig = getFeishuConfig()) {}

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const token = await this.getTenantAccessToken();
    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    return parseFeishuResponse<T>(response, path);
  }

  async downloadBinary(path: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    const token = await this.getTenantAccessToken();
    const url = this.buildUrl(path);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Feishu binary download failed with HTTP ${response.status}: ${path}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const data = await response.arrayBuffer();

    return { data, contentType };
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const response = await fetch(this.buildUrl("/open-apis/auth/v3/tenant_access_token/internal"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret
      })
    });
    const data = await parseFeishuResponse<TenantAccessTokenResponse>(response, "tenant_access_token");

    this.accessToken = data.tenant_access_token;
    this.accessTokenExpiresAt = now + Math.max(data.expire - 120, 60) * 1000;

    return this.accessToken;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }
}

async function parseFeishuResponse<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  let body: FeishuApiResponse<T> | null = null;

  try {
    body = text ? (JSON.parse(text) as FeishuApiResponse<T>) : null;
  } catch {
    throw new Error(`Feishu ${operation} returned non-JSON response with HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Feishu ${operation} failed with HTTP ${response.status}: ${body?.msg ?? text}`);
  }

  if (!body || body.code !== 0) {
    throw new Error(`Feishu ${operation} failed: ${body?.msg ?? "unknown error"} (${body?.code ?? "no code"})`);
  }

  return (body.data ?? body) as T;
}

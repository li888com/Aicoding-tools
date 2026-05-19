import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import FormData from "form-data";
import type { IpGuardConfig, IpGuardLoginResponse, IpGuardUploadResponse, IpGuardEncryptCheckResponse, IpGuardDecryptResponse } from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class IpGuardClient {
  constructor(private readonly config: IpGuardConfig) {}

  async login(): Promise<string> {
    const url = `${this.config.url}/interface/wapi/login`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Name: this.config.name,
        Password: this.config.password,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard login failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as IpGuardLoginResponse;
    if (data.error !== "0") {
      throw new Error(`IP-Guard login failed: error=${data.error}`);
    }

    return data.loginid;
  }

  async upload(loginId: string, filePath: string): Promise<unknown> {
    const url = `${this.config.url}/interface/wapi/uploadfileV2`;
    const form = new FormData();

    form.append("loginid", loginId);

    const fileExt = extname(filePath).slice(1).toLowerCase();
    const mimeType = fileExt === "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : `application/${fileExt}`;

    const fileBuffer = await readFile(filePath);
    form.append("file", fileBuffer, {
      filename: basename(filePath),
      contentType: mimeType,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: form.getHeaders(),
      body: new Uint8Array(form.getBuffer()),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard upload failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as IpGuardUploadResponse;
    if (data.error !== "0") {
      throw new Error(`IP-Guard upload failed: error=${data.error}`);
    }

    return data.file;
  }

  async checkEncrypted(loginId: string, fileObj: unknown): Promise<boolean> {
    const url = `${this.config.url}/interface/wapi/isSdFile`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ LoginID: loginId, File: fileObj }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard encryption check failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as IpGuardEncryptCheckResponse;
    if (data.error !== "0") {
      throw new Error(`IP-Guard encryption check failed: error=${data.error}`);
    }

    return data.encrypt;
  }

  async triggerDecrypt(loginId: string, fileObj: unknown): Promise<void> {
    const url = `${this.config.url}/interface/wapi/decryptFile`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ LoginID: loginId, File: fileObj }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard decrypt trigger failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as IpGuardDecryptResponse;
    if (data.error !== "0") {
      throw new Error(`IP-Guard decrypt trigger failed: error=${data.error}`);
    }
  }

  async downloadDecrypted(loginId: string, fileObj: unknown, originalPath: string): Promise<string> {
    const url = `${this.config.url}/interface/wapi/downloadfileV2`;
    const params = new URLSearchParams();
    params.append("LoginID", loginId);
    params.append("File", String(fileObj));

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard download failed: HTTP ${response.status}`);
    }

    const fileName = extractFilenameFromDisposition(response.headers.get("Content-Disposition"))
      ?? basename(originalPath);

    const downloadPath = join(tmpdir(), fileName);
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(downloadPath, Buffer.from(arrayBuffer));

    return downloadPath;
  }
}

function extractFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=utf-8''(.+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const match = disposition.match(/filename="?([^";\s]+)"?/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return null;
}
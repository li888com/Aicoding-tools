# IP-Guard File Decrypt MCP Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `decrypt_file` MCP tool to mcp-toolbox that decrypts local IP-Guard-encrypted files via the IP-Guard server HTTP API.

**Architecture:** Replicate the 4-step Java workflow (login → upload → check → decrypt+download) in TypeScript. Follow existing MCP project patterns (config from env vars, integration client + service, zod tool schema, registerXxxTools pattern).

**Tech Stack:** TypeScript/ESM, Node.js 18+ native `fetch`, `form-data` npm package for multipart uploads, `zod` for MCP tool schemas, `@modelcontextprotocol/sdk`.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/integrations/ipguard/types.ts` | IP-Guard API response types + config type |
| Create | `src/integrations/ipguard/client.ts` | HTTP client for IP-Guard API (login, upload, check, decrypt, download) |
| Create | `src/integrations/ipguard/decrypt.ts` | Orchestrates 4-step decrypt workflow + file type detection |
| Create | `src/tools/file-decrypt.ts` | MCP tool definition (decrypt_file) |
| Modify | `src/config.ts` | Add `getIpGuardConfig()` |
| Modify | `src/index.ts` | Register file-decrypt tools |
| Modify | `package.json` | Add `form-data` dependency |
| Modify | `.env.example` | Add IPGUARD_* env vars |

---

### Task 1: Add dependency and config

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install `form-data` package**

Run: `cd /Users/dubo/Documents/sbt/sl/mcp && npm install form-data`
Expected: package.json updated with `form-data` dependency

- [ ] **Step 2: Add IP-Guard config to `src/config.ts`**

Add after the existing `getFeishuConfig()` function (line 60):

```typescript
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
```

- [ ] **Step 3: Add env vars to `.env.example`**

Append after the FEISHU variables (line 15):

```
IPGUARD_URL=http://192.168.10.30:8095
IPGUARD_NAME=ipguard-dify
IPGUARD_PASSWORD=IPGUARD#dify202509
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/config.ts .env.example
git commit -m "feat: add IP-Guard config and form-data dependency"
```

---

### Task 2: Create IP-Guard types

**Files:**
- Create: `src/integrations/ipguard/types.ts`

- [ ] **Step 1: Create directory and types file**

```typescript
export type IpGuardConfig = {
  url: string;
  name: string;
  password: string;
};

export type IpGuardLoginResponse = {
  error: string;
  loginid: string;
};

export type IpGuardUploadResponse = {
  error: string;
  file: unknown;
};

export type IpGuardEncryptCheckResponse = {
  error: string;
  encrypt: boolean;
};

export type IpGuardDecryptResponse = {
  error: string;
};

export type DecryptResult = {
  type: "text" | "binary";
  content?: string;
  decryptedFilePath?: string;
  originalFilePath: string;
  wasEncrypted: boolean;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/ipguard/types.ts
git commit -m "feat: add IP-Guard API types"
```

---

### Task 3: Create IP-Guard HTTP client

**Files:**
- Create: `src/integrations/ipguard/client.ts`

- [ ] **Step 1: Create the client file**

```typescript
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import FormData from "form-data";
import type { IpGuardConfig } from "./types.js";

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

    const data = (await response.json()) as { error: string; loginid: string };
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

    form.append("file", createReadStream(filePath), {
      filename: basename(filePath),
      contentType: mimeType,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: form.getHeaders(),
      body: form.getBuffer(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`IP-Guard upload failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { error: string; file: unknown };
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

    const data = (await response.json()) as { error: string; encrypt: boolean };
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

    const data = (await response.json()) as { error: string };
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

  // Handle filename*=utf-8''encodedFilename
  const utf8Match = disposition.match(/filename\*=utf-8''(.+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  // Handle filename="xxx" or filename=xxx
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
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/ipguard/client.ts
git commit -m "feat: add IP-Guard HTTP client"
```

---

### Task 4: Create decrypt service

**Files:**
- Create: `src/integrations/ipguard/decrypt.ts`

- [ ] **Step 1: Create the decrypt service file**

```typescript
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { access } from "node:fs/promises";
import { getIpGuardConfig } from "../../config.js";
import { IpGuardClient } from "./client.js";
import type { DecryptResult } from "./types.js";

const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "md", "json", "xml", "html", "css", "js", "ts",
  "py", "java", "yaml", "yml", "log", "ini", "cfg", "conf",
  "sh", "bat", "toml", "env", "gitignore", "editorconfig",
]);

export class FileDecryptService {
  private readonly client: IpGuardClient;

  constructor(config = getIpGuardConfig()) {
    this.client = new IpGuardClient(config);
  }

  async decryptFile(filePath: string): Promise<DecryptResult> {
    await this.validateFileExists(filePath);

    const loginId = await this.client.login();
    const fileObj = await this.client.upload(loginId, filePath);
    const isEncrypted = await this.client.checkEncrypted(loginId, fileObj);

    let resultPath: string;
    if (isEncrypted) {
      await this.client.triggerDecrypt(loginId, fileObj);
      resultPath = await this.client.downloadDecrypted(loginId, fileObj, filePath);
    } else {
      resultPath = filePath;
    }

    const ext = extname(resultPath).slice(1).toLowerCase();
    const isText = TEXT_EXTENSIONS.has(ext);

    if (isText) {
      const content = await readFile(resultPath, "utf-8");
      return {
        type: "text",
        content,
        originalFilePath: filePath,
        wasEncrypted: isEncrypted,
      };
    }

    return {
      type: "binary",
      decryptedFilePath: resultPath,
      originalFilePath: filePath,
      wasEncrypted: isEncrypted,
    };
  }

  private async validateFileExists(filePath: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/ipguard/decrypt.ts
git commit -m "feat: add file decrypt service"
```

---

### Task 5: Create MCP tool definition

**Files:**
- Create: `src/tools/file-decrypt.ts`

- [ ] **Step 1: Create the tool file**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FileDecryptService } from "../integrations/ipguard/decrypt.js";

export function registerFileDecryptTools(server: McpServer): void {
  server.tool(
    "decrypt_file",
    "Decrypt a local file encrypted by IP-Guard DRM via the IP-Guard server API. Returns text content for text files, or a decrypted file path for binary files.",
    {
      filePath: z
        .string()
        .min(1)
        .describe("Absolute path to the local file to decrypt."),
    },
    async ({ filePath }) => {
      const result = await new FileDecryptService().decryptFile(filePath);

      return {
        content: [
          {
            type: "text",
            text: result.type === "text"
              ? result.content ?? ""
              : JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/file-decrypt.ts
git commit -m "feat: add decrypt_file MCP tool"
```

---

### Task 6: Wire up in entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import and registration**

Add after the existing feishu import (line 6):

```typescript
import { registerFileDecryptTools } from "./tools/file-decrypt.js";
```

Add after the feishu registration (line 14):

```typescript
registerFileDecryptTools(server);
```

Full modified file:

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closePool } from "./database.js";
import { registerAiCodingStatsTools } from "./tools/ai-coding-stats.js";
import { registerFeishuDocsTools } from "./tools/feishu-docs.js";
import { registerFileDecryptTools } from "./tools/file-decrypt.js";

const server = new McpServer({
  name: "mcp-toolbox",
  version: "0.1.0"
});

registerAiCodingStatsTools(server);
registerFeishuDocsTools(server);
registerFileDecryptTools(server);

const transport = new StdioServerTransport();

process.on("SIGINT", () => {
  void closePool().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void closePool().finally(() => process.exit(0));
});

await server.connect(transport);
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: register decrypt_file tool in MCP server"
```

---

### Task 7: Build and verify

**Files:**
- None (verification only)

- [ ] **Step 1: Build the project**

Run: `cd /Users/dubo/Documents/sbt/sl/mcp && npm run build`
Expected: Clean compile, no TypeScript errors, `dist/` output updated

- [ ] **Step 2: Verify MCP server starts**

Run: `cd /Users/dubo/Documents/sbt/sl/mcp && timeout 5 npm run dev || true`
Expected: Server starts without crash. May show "MCP server connected" or similar output from stderr.

- [ ] **Step 3: Commit any build fixes if needed**

If the build required additional changes (missing types, import adjustments), commit them:

```bash
git add -A
git commit -m "fix: resolve build issues for IP-Guard decrypt tool"
```

---

### Task 8: Add verification script

**Files:**
- Create: `scripts/verify-file-decrypt.ts`
- Modify: `package.json`

- [ ] **Step 1: Create verification script**

```typescript
import { FileDecryptService } from "../src/integrations/ipguard/decrypt.js";

async function verify(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx scripts/verify-file-decrypt.ts <file-path>");
    process.exit(1);
  }

  console.log(`Decrypting file: ${filePath}`);
  try {
    const service = new FileDecryptService();
    const result = await service.decryptFile(filePath);

    console.log("\nDecrypt result:");
    console.log(JSON.stringify(result, null, 2));

    if (result.type === "text" && result.content) {
      console.log("\nContent preview (first 500 chars):");
      console.log(result.content.slice(0, 500));
    } else if (result.type === "binary" && result.decryptedFilePath) {
      console.log(`\nDecrypted file saved to: ${result.decryptedFilePath}`);
    }

    console.log("\nVerification PASSED");
  } catch (error) {
    console.error("\nVerification FAILED:", error);
    process.exit(1);
  }
}

verify();
```

- [ ] **Step 2: Add script to package.json**

Add to scripts section:

```json
"test:decrypt": "tsx scripts/verify-file-decrypt.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-file-decrypt.ts package.json
git commit -m "feat: add file decrypt verification script"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All design sections (types, client, decrypt service, MCP tool, config, index wiring, .env) have corresponding tasks
- [x] **Placeholder scan**: No TBD, TODO, or "implement later" patterns. All code is complete.
- [x] **Type consistency**: `IpGuardConfig` defined in `types.ts` and imported by `client.ts`; `DecryptResult` defined in `types.ts` and used by `decrypt.ts` and `file-decrypt.ts`; method signatures consistent across all files
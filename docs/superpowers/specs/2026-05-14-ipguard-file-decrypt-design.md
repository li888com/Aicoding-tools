---
name: ipguard-file-decrypt-mcp
date: 2026-05-14
status: approved
---

# IP-Guard File Decrypt MCP Tool Design

## Summary

Add a new MCP tool `decrypt_file` to `mcp-toolbox` that decrypts local files encrypted by IP-Guard DRM. The decryption is performed via the IP-Guard server HTTP API (login → upload → check → decrypt → download), replicating the workflow from the Java `FileDecryptUtil`.

## Architecture

```
src/
  integrations/
    ipguard/
      types.ts       — IP-Guard API response types
      client.ts      — IP-Guard HTTP client (login, upload, check, decrypt, download)
      decrypt.ts     — Decrypt service (orchestrates 4-step workflow + file type detection)
  tools/
    file-decrypt.ts  — MCP tool definition (1 tool: decrypt_file)
```

## New Files

### `src/integrations/ipguard/types.ts` (~50 lines)

- `IpGuardLoginResponse` — login response (loginid)
- `IpGuardUploadResponse` — upload response (file object)
- `IpGuardEncryptCheckResponse` — encryption check response (encrypt boolean)
- `IpGuardDecryptResponse` — decrypt trigger response
- `IpGuardConfig` — config type (url, name, password)

### `src/integrations/ipguard/client.ts` (~150 lines)

`IpGuardClient` class with methods:

- `login()` — POST `/interface/wapi/login`, returns loginid
- `upload(filePath, loginid)` — POST `/interface/wapi/uploadfileV2` (multipart/form-data)
- `checkEncrypted(loginid, fileObj)` — POST `/interface/wapi/isSdFile`
- `decrypt(loginid, fileObj)` — POST `/interface/wapi/decryptFile`
- `download(loginid, fileObj)` — POST `/interface/wapi/downloadfileV2`, saves to temp dir

Uses Node.js native `fetch` + `FormData` (Node 18+). Handles `.pptx` extension MIME type mapping (consistent with Java code).

### `src/integrations/ipguard/decrypt.ts` (~80 lines)

`FileDecryptService.decryptFile(filePath)`:

1. login → get loginid
2. upload → get file object
3. checkEncrypted → determine if encrypted
4. If encrypted: decrypt → download → return decrypted file path
5. If not encrypted: return original file path
6. Auto-detect file type: text files return content, binary files return path

### `src/tools/file-decrypt.ts` (~60 lines)

`registerFileDecryptTools(server: McpServer)`:

- Tool: `decrypt_file`
- Input: `filePath` (string, absolute path)
- Output: text file → `{ type: "text", content: "..." }`; binary file → `{ type: "binary", decryptedFilePath: "..." }`

## Modified Files

### `src/config.ts`

Add IP-Guard config:

```typescript
export const ipguardConfig = {
  url: process.env.IPGUARD_URL || 'http://192.168.10.30:8095',
  name: process.env.IPGUARD_NAME || 'ipguard-dify',
  password: process.env.IPGUARD_PASSWORD || 'IPGUARD#dify202509',
}
```

### `src/index.ts`

Register new tool group:

```typescript
import { registerFileDecryptTools } from './tools/file-decrypt.js'
registerFileDecryptTools(server)
```

### `package.json`

Add `form-data` dependency if Node.js native FormData doesn't fully support file stream uploads (verify first).

### `.env.example`

Add:

```
IPGUARD_URL=http://192.168.10.30:8095
IPGUARD_NAME=ipguard-dify
IPGUARD_PASSWORD=IPGUARD#dify202509
```

## Data Flow

```
AI Agent calls decrypt_file(filePath)
  → FileDecryptService.decryptFile(filePath)
    → IpGuardClient.login() → loginid
    → IpGuardClient.upload(filePath, loginid) → fileObj
    → IpGuardClient.checkEncrypted(loginid, fileObj) → isEncrypted
    → if encrypted:
        IpGuardClient.decrypt(loginid, fileObj)
        IpGuardClient.download(loginid, fileObj) → decryptedFilePath
    → if not encrypted:
        original filePath
  → detect file type
    → text file: read content, return
    → binary file: return path
  → MCP tool returns result
```

## Error Handling

- File not found → error message
- IP-Guard login failure → error + raw response info
- Upload/decrypt failure → step name + error details
- Download failure → error
- Network timeout → 30s timeout per request

## Dependencies

- Node.js 18+ native `fetch` and `FormData`
- `form-data` package if native FormData lacks file stream support
- `zod` — existing, for MCP tool input schema

## Approach

Chosen: **Approach A** — Direct replica of Java workflow, no session caching, simplest correct version. Session caching can be added later if needed.
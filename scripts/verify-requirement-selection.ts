import "dotenv/config";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as localStorage from "../src/local-storage.js";

const storageDir = join(tmpdir(), `mcp-toolbox-requirement-selection-${process.pid}-${Date.now()}`);
const conversationId = "codex:test-requirement-selection";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}
env.MCP_TOOLBOX_STORAGE_DIR = storageDir;
env.AI_CODING_REQUIREMENT_API_MODE = "local";

await mkdir(storageDir, { recursive: true });
localStorage.setStorageDir(storageDir);

try {
  const now = new Date().toISOString();
  await localStorage.saveRequirement({
    requirementId: 701,
    title: "Login captcha optimization",
    projectName: "CRM",
    gpmNumber: "GPM-202605-001",
    status: "active",
    description: "Improve login captcha error messages",
    createdAt: now,
    updatedAt: now,
  });
  await localStorage.saveRequirement({
    requirementId: 702,
    title: "Order export performance",
    projectName: "OMS",
    gpmNumber: "GPM-202605-002",
    status: "done",
    description: "Optimize export query",
    createdAt: now,
    updatedAt: now,
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "mcp-toolbox-requirement-selection-test",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    for (const requiredTool of [
      "list_ai_coding_requirements",
      "get_ai_coding_requirement",
      "select_ai_coding_requirement",
      "clear_ai_coding_requirement_selection",
    ]) {
      if (!toolNames.includes(requiredTool)) {
        throw new Error(`MCP tool is missing: ${requiredTool}`);
      }
    }

    const listed = await client.callTool({
      name: "list_ai_coding_requirements",
      arguments: {
        keyword: "login",
        limit: 5,
      },
    });
    const listedContent = listed.structuredContent as { items?: Array<{ requirementId: number }> };
    if (listedContent.items?.[0]?.requirementId !== 701) {
      throw new Error(`Unexpected list result: ${JSON.stringify(listed.structuredContent)}`);
    }

    const selected = await client.callTool({
      name: "select_ai_coding_requirement",
      arguments: {
        conversationId,
        requirementId: 701,
        selectedBy: "verify-script",
      },
    });
    const selectedContent = selected.structuredContent as { requirementId?: number };
    if (selectedContent.requirementId !== 701) {
      throw new Error(`Unexpected selection result: ${JSON.stringify(selected.structuredContent)}`);
    }

    const inherited = await client.callTool({
      name: "record_ai_coding_round",
      arguments: {
        conversationId,
        startedAt: new Date(Date.now() - 1000).toISOString(),
        endedAt: new Date().toISOString(),
        modelName: "verify-model",
        promptText: "implement without explicit marker",
        filesChanged: 0,
        linesAdded: 0,
        linesDeleted: 0,
        codeLinesChanged: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });
    const inheritedContent = inherited.structuredContent as {
      requirementId?: number;
      requirementSource?: string;
    };
    if (inheritedContent.requirementId !== 701 || inheritedContent.requirementSource !== "context") {
      throw new Error(`Unexpected inherited round result: ${JSON.stringify(inherited.structuredContent)}`);
    }

    const cleared = await client.callTool({
      name: "clear_ai_coding_requirement_selection",
      arguments: {
        conversationId,
      },
    });
    const clearedContent = cleared.structuredContent as { requirementId?: number | null };
    if (clearedContent.requirementId !== null) {
      throw new Error(`Unexpected clear result: ${JSON.stringify(cleared.structuredContent)}`);
    }

    console.log("requirement selection tools verified");
  } finally {
    await client.close();
  }
} finally {
  await rm(storageDir, { recursive: true, force: true });
}

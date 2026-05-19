import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const input = process.argv[2] ?? "https://sbtjt.feishu.cn/wiki/VZenwvH1hi9QN9kTptPc9AHZnLb";

const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    env[key] = value;
  }
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env,
  stderr: "pipe"
});

const client = new Client({
  name: "mcp-toolbox-smoke-test",
  version: "0.1.0"
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  console.log("tools:", toolNames.join(", "));

  for (const requiredTool of ["feishu_parse_doc_url", "feishu_get_doc_meta", "feishu_get_doc_content"]) {
    if (!toolNames.includes(requiredTool)) {
      throw new Error(`MCP tool is missing: ${requiredTool}`);
    }
  }

  const parsed = await client.callTool({
    name: "feishu_parse_doc_url",
    arguments: {
      input
    }
  });

  console.log("parse:", JSON.stringify(parsed.structuredContent, null, 2));
} finally {
  await client.close();
}

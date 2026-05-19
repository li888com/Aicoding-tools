#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "mini-mcp",
  version: "0.0.1"
});

server.tool(
  "hello",
  "Say hello and optionally greet a name.",
  {
    name: z.string().min(1).optional().describe("Name to greet.")
  },
  async ({ name }) => {
    const greeting = `Hello${name ? `, ${name}` : ""}!`;
    return {
      content: [{ type: "text", text: greeting }],
      structuredContent: { greeting }
    };
  }
);

await server.connect(new StdioServerTransport());

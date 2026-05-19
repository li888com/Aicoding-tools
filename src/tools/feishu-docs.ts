import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FeishuDocsService } from "../integrations/feishu/docs.js";

const documentInputSchema = {
  input: z.string().min(1).describe("Feishu document URL, wiki URL, or supported document token.")
};

export function registerFeishuDocsTools(server: McpServer): void {
  server.tool(
    "feishu_parse_doc_url",
    "Parse a Feishu docx/doc/wiki URL and return the document type and token.",
    documentInputSchema,
    async ({ input }) => {
      const parsed = new FeishuDocsService().parse(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(parsed, null, 2)
          }
        ],
        structuredContent: parsed
      };
    }
  );

  server.tool(
    "feishu_get_doc_meta",
    "Read metadata for a Feishu cloud document. Wiki URLs are resolved to their backing doc/docx object first.",
    documentInputSchema,
    async ({ input }) => {
      const meta = await new FeishuDocsService().getMeta(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(meta, null, 2)
          }
        ],
        structuredContent: meta
      };
    }
  );

  server.tool(
    "feishu_get_doc_content",
    "Read rich content from a Feishu cloud document. Supports docx/doc URLs and wiki URLs that resolve to docs. For docx documents, uses the Blocks API to preserve tables, images, and links in Markdown format.",
    documentInputSchema,
    async ({ input }) => {
      const result = await new FeishuDocsService().getRichContent(input);
      const structuredContent = {
        type: result.document.type,
        token: result.document.token,
        title: result.document.title,
        wikiNode: result.document.wikiNode,
        format: "markdown",
        content: result.content
      };

      return {
        content: [
          {
            type: "text",
            text: result.content
          }
        ],
        structuredContent
      };
    }
  );
}

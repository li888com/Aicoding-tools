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
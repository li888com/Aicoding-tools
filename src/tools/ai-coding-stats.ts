import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordRound, recordRoundRevert } from "../database.js";

const nonNegativeInteger = z.number().int().nonnegative();

export function registerAiCodingStatsTools(server: McpServer): void {
  server.tool(
    "record_ai_coding_round",
    "Record one finished AI Coding round into local JSON storage. Requirement ids like #12 are parsed from promptText; otherwise the previous conversation context is reused.",
    {
      conversationId: z
        .string()
        .min(1)
        .describe("Stable id for the AI Coding conversation/thread."),
      startedAt: z.string().datetime().describe("Round start time, ISO 8601."),
      endedAt: z.string().datetime().describe("Round end time, ISO 8601."),
      modelName: z.string().min(1).describe("AI model name used in this round."),
      promptText: z.string().optional().describe("User prompt text. A token such as #12 means requirement id 12."),
      filesChanged: nonNegativeInteger.optional().describe("Number of changed files."),
      linesAdded: nonNegativeInteger.optional().describe("Added code lines."),
      linesDeleted: nonNegativeInteger.optional().describe("Deleted code lines."),
      codeLinesChanged: nonNegativeInteger
        .optional()
        .describe("Total changed code lines. Defaults to linesAdded + linesDeleted."),
      inputTokens: nonNegativeInteger.optional().describe("Consumed input tokens."),
      outputTokens: nonNegativeInteger.optional().describe("Consumed output tokens."),
      totalTokens: nonNegativeInteger
        .optional()
        .describe("Total consumed tokens. Defaults to inputTokens + outputTokens."),
      metadata: z.record(z.unknown()).optional().describe("Optional extra structured data.")
    },
    async (input) => {
      const recorded = await recordRound(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(recorded, null, 2)
          }
        ],
        structuredContent: recorded
      };
    }
  );

  server.tool(
    "record_ai_coding_round_revert",
    "Record that a previous AI Coding round's code changes were reverted. The original round is preserved for audit, and effective statistics should exclude reverted rounds.",
    {
      conversationId: z
        .string()
        .min(1)
        .describe("Stable id for the AI Coding conversation/thread."),
      targetRoundId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Round id to mark as reverted. If omitted, the latest active round in the conversation is used."),
      revertedAt: z.string().datetime().describe("Revert completion time, ISO 8601."),
      modelName: z.string().min(1).describe("AI model name used for the revert operation."),
      promptText: z.string().optional().describe("User prompt that requested the revert."),
      reason: z.string().max(512).optional().describe("Short reason for the revert."),
      filesChanged: nonNegativeInteger.optional().describe("Number of files changed by the revert operation."),
      linesAdded: nonNegativeInteger.optional().describe("Added lines from the revert operation."),
      linesDeleted: nonNegativeInteger.optional().describe("Deleted lines from the revert operation."),
      codeLinesChanged: nonNegativeInteger
        .optional()
        .describe("Total changed code lines from the revert operation. Defaults to linesAdded + linesDeleted."),
      inputTokens: nonNegativeInteger.optional().describe("Consumed input tokens for the revert operation."),
      outputTokens: nonNegativeInteger.optional().describe("Consumed output tokens for the revert operation."),
      totalTokens: nonNegativeInteger
        .optional()
        .describe("Total consumed tokens for the revert operation. Defaults to inputTokens + outputTokens."),
      metadata: z.record(z.unknown()).optional().describe("Optional extra structured data.")
    },
    async (input) => {
      const recorded = await recordRoundRevert(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(recorded, null, 2)
          }
        ],
        structuredContent: recorded
      };
    }
  );
}

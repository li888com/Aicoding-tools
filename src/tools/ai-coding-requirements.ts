import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRequirementApiConfig } from "../config.js";
import * as localStorage from "../local-storage.js";

type RequirementSummary = {
  requirementId: number;
  title: string | null;
  projectName: string | null;
  gpmNumber: string | null;
  status: "active" | "done" | "archived";
  description: string | null;
  updatedAt: string;
};

type RequirementListResult = {
  source: "local" | "remote";
  items: RequirementSummary[];
};

type RequirementSelectionResult = {
  conversationId: string;
  requirementId: number;
  requirementLabel: string;
  source: "skill";
  selectedAt: string;
};

type RequirementClearResult = {
  conversationId: string;
  requirementId: null;
  clearedAt: string;
};

const requirementStatusSchema = z.enum(["active", "done", "archived"]);
const positiveIdSchema = z.number().int().positive();

export function registerAiCodingRequirementTools(server: McpServer): void {
  server.tool(
    "list_ai_coding_requirements",
    "List AI Coding requirements for selection. Currently reads local maintained requirements; remote API configuration is reserved for later use.",
    {
      keyword: z.string().trim().optional().describe("Keyword matched against id, title, project, GPM, and description."),
      status: requirementStatusSchema.optional().describe("Requirement status filter."),
      projectName: z.string().trim().optional().describe("Project name filter."),
      limit: z.number().int().positive().max(50).optional().describe("Maximum result count. Defaults to 10."),
    },
    async (input) => {
      const result = await listRequirements(input);
      return asToolResult(result);
    }
  );

  server.tool(
    "get_ai_coding_requirement",
    "Get one AI Coding requirement by id from the configured requirement source.",
    {
      requirementId: positiveIdSchema.describe("Requirement id."),
    },
    async ({ requirementId }) => {
      const requirement = await getRequirement(requirementId);
      if (!requirement) {
        throw new Error(`Requirement #${requirementId} was not found`);
      }

      return asToolResult(requirement);
    }
  );

  server.tool(
    "select_ai_coding_requirement",
    "Bind the current AI Coding conversation to a requirement. Later round records inherit this requirement when promptText has no #id marker.",
    {
      conversationId: z.string().min(1).describe("Stable AI Coding conversation id."),
      requirementId: positiveIdSchema.describe("Requirement id to bind."),
      selectedBy: z.string().trim().optional().describe("Client or actor that selected this requirement."),
    },
    async ({ conversationId, requirementId, selectedBy }) => {
      const result = await selectRequirement(conversationId, requirementId, selectedBy);
      return asToolResult(result);
    }
  );

  server.tool(
    "clear_ai_coding_requirement_selection",
    "Clear the current requirement selection for an AI Coding conversation.",
    {
      conversationId: z.string().min(1).describe("Stable AI Coding conversation id."),
    },
    async ({ conversationId }) => {
      const result = await clearRequirementSelection(conversationId);
      return asToolResult(result);
    }
  );
}

async function listRequirements(input: {
  keyword?: string;
  status?: "active" | "done" | "archived";
  projectName?: string;
  limit?: number;
}): Promise<RequirementListResult> {
  const config = getRequirementApiConfig();
  if (config.mode === "remote") {
    throw new Error("Remote requirement API mode is configured but not implemented yet; use AI_CODING_REQUIREMENT_API_MODE=local");
  }

  const keyword = normalizeSearchText(input.keyword);
  const projectName = normalizeSearchText(input.projectName);
  const limit = input.limit ?? 10;
  const requirements = await localStorage.getRequirements();

  const items = requirements
    .filter((requirement) => {
      if (input.status && requirement.status !== input.status) return false;
      if (projectName && !normalizeSearchText(requirement.projectName).includes(projectName)) return false;
      if (!keyword) return true;
      return requirementSearchText(requirement).includes(keyword);
    })
    .sort((a, b) => {
      const statusRank = statusSortRank(a.status) - statusSortRank(b.status);
      if (statusRank !== 0) return statusRank;
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return a.requirementId - b.requirementId;
    })
    .slice(0, limit)
    .map(toRequirementSummary);

  return {
    source: "local",
    items,
  };
}

async function getRequirement(requirementId: number): Promise<RequirementSummary | null> {
  const config = getRequirementApiConfig();
  if (config.mode === "remote") {
    throw new Error("Remote requirement API mode is configured but not implemented yet; use AI_CODING_REQUIREMENT_API_MODE=local");
  }

  const requirement = await localStorage.getRequirement(requirementId);
  return requirement ? toRequirementSummary(requirement) : null;
}

async function selectRequirement(
  conversationId: string,
  requirementId: number,
  selectedBy?: string
): Promise<RequirementSelectionResult> {
  const requirement = await getRequirement(requirementId);
  if (!requirement) {
    throw new Error(`Requirement #${requirementId} was not found`);
  }

  const now = new Date().toISOString();
  const conversation = await localStorage.getConversation(conversationId);
  await localStorage.saveConversation({
    conversationId,
    currentRequirementId: requirementId,
    lastRoundId: conversation?.lastRoundId ?? null,
    firstSeenAt: conversation?.firstSeenAt ?? now,
    lastSeenAt: now,
  });
  void selectedBy;

  return {
    conversationId,
    requirementId,
    requirementLabel: requirementLabel(requirement),
    source: "skill",
    selectedAt: now,
  };
}

async function clearRequirementSelection(conversationId: string): Promise<RequirementClearResult> {
  const now = new Date().toISOString();
  const conversation = await localStorage.getConversation(conversationId);
  await localStorage.saveConversation({
    conversationId,
    currentRequirementId: null,
    lastRoundId: conversation?.lastRoundId ?? null,
    firstSeenAt: conversation?.firstSeenAt ?? now,
    lastSeenAt: now,
  });

  return {
    conversationId,
    requirementId: null,
    clearedAt: now,
  };
}

function asToolResult<T>(structuredContent: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  };
}

function toRequirementSummary(requirement: localStorage.Requirement): RequirementSummary {
  return {
    requirementId: requirement.requirementId,
    title: requirement.title,
    projectName: requirement.projectName,
    gpmNumber: requirement.gpmNumber,
    status: requirement.status,
    description: requirement.description,
    updatedAt: requirement.updatedAt,
  };
}

function normalizeSearchText(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function requirementSearchText(requirement: localStorage.Requirement): string {
  return normalizeSearchText([
    requirement.requirementId,
    requirement.title,
    requirement.projectName,
    requirement.gpmNumber,
    requirement.status,
    requirement.description,
  ].filter((value) => value !== null && value !== undefined).join(" "));
}

function statusSortRank(status: localStorage.Requirement["status"]): number {
  if (status === "active") return 0;
  if (status === "done") return 1;
  return 2;
}

function requirementLabel(requirement: RequirementSummary): string {
  return `#${requirement.requirementId}${requirement.title ? ` ${requirement.title}` : ""}`;
}

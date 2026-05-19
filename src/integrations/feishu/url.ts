import type { ParsedFeishuDocUrl } from "./types.js";

const DOC_TYPES = new Set(["docx", "doc", "wiki"]);

export function parseFeishuDocUrl(input: string): ParsedFeishuDocUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Feishu document URL or token is required");
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const docTypeIndex = segments.findIndex((segment) => DOC_TYPES.has(segment));
    if (docTypeIndex < 0 || !segments[docTypeIndex + 1]) {
      throw new Error(`Unsupported Feishu document URL: ${trimmed}`);
    }

    return {
      source: "url",
      type: segments[docTypeIndex] as ParsedFeishuDocUrl["type"],
      token: segments[docTypeIndex + 1],
      host: url.host,
      originalInput: input
    };
  } catch (error) {
    if (error instanceof TypeError) {
      return {
        source: "token",
        type: "unknown",
        token: trimmed,
        originalInput: input
      };
    }

    throw error;
  }
}

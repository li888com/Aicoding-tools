export type FeishuConfig = {
  appId: string;
  appSecret: string;
  baseUrl: string;
};

export type FeishuDocType = "docx" | "doc" | "wiki" | "unknown";

export type ParsedFeishuDocUrl = {
  source: "url" | "token";
  type: FeishuDocType;
  token: string;
  host?: string;
  originalInput: string;
};

export type ResolvedFeishuDocument = {
  type: "docx" | "doc";
  token: string;
  title?: string;
  source: ParsedFeishuDocUrl;
  wikiNode?: {
    spaceId?: string;
    nodeToken?: string;
    objToken?: string;
    objType?: string;
  };
};

export type FeishuDocumentMeta = {
  type: "docx" | "doc";
  token: string;
  title?: string;
  revisionId?: number | string;
  wikiNode?: ResolvedFeishuDocument["wikiNode"];
  raw?: unknown;
};

export type { FeishuBlock, FeishuBlocksResponse } from "./block-types.js";

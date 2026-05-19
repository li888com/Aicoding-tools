import { FeishuClient } from "./client.js";
import { parseFeishuDocUrl } from "./url.js";
import type { FeishuBlock, FeishuBlocksResponse, FeishuDocumentMeta, ParsedFeishuDocUrl, ResolvedFeishuDocument } from "./types.js";
import { renderBlocksToMarkdown } from "./renderer.js";

type WikiNodeResponse = {
  node?: {
    space_id?: string;
    node_token?: string;
    obj_token?: string;
    obj_type?: string;
    title?: string;
  };
};

type DocxMetaResponse = {
  document?: {
    document_id?: string;
    revision_id?: number | string;
    title?: string;
  };
};

type RawContentResponse = {
  content?: string;
};

export class FeishuDocsService {
  constructor(private readonly client = new FeishuClient()) {}

  parse(input: string): ParsedFeishuDocUrl {
    return parseFeishuDocUrl(input);
  }

  async getMeta(input: string): Promise<FeishuDocumentMeta> {
    const document = await this.resolveDocument(input);

    if (document.type === "doc") {
      return {
        type: document.type,
        token: document.token,
        title: document.title,
        wikiNode: document.wikiNode
      };
    }

    const meta = await this.client.get<DocxMetaResponse>(
      `/open-apis/docx/v1/documents/${encodeURIComponent(document.token)}`
    );

    return {
      type: document.type,
      token: document.token,
      title: meta.document?.title ?? document.title,
      revisionId: meta.document?.revision_id,
      wikiNode: document.wikiNode,
      raw: meta.document
    };
  }

  async getRawContent(input: string): Promise<{
    document: ResolvedFeishuDocument;
    content: string;
  }> {
    const document = await this.resolveDocument(input);
    const path =
      document.type === "docx"
        ? `/open-apis/docx/v1/documents/${encodeURIComponent(document.token)}/raw_content`
        : `/open-apis/doc/v2/${encodeURIComponent(document.token)}/raw_content`;
    const rawContent = await this.client.get<RawContentResponse>(path);

    return {
      document,
      content: rawContent.content ?? ""
    };
  }

  async getRichContent(input: string): Promise<{
    document: ResolvedFeishuDocument;
    content: string;
  }> {
    const document = await this.resolveDocument(input);

    if (document.type === "doc") {
      return this.getRawContent(input);
    }

    const blocks = await this.getBlocks(document.token);
    const content = await renderBlocksToMarkdown(blocks, document.token, this.client);

    return { document, content };
  }

  async getBlocks(documentToken: string): Promise<FeishuBlock[]> {
    const allBlocks: FeishuBlock[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.client.get<FeishuBlocksResponse>(
        `/open-apis/docx/v1/documents/${encodeURIComponent(documentToken)}/blocks`,
        { page_size: 500, page_token: pageToken }
      );

      allBlocks.push(...response.items);

      pageToken = response.has_more ? response.page_token : undefined;
    } while (pageToken);

    return allBlocks;
  }

  async resolveDocument(input: string): Promise<ResolvedFeishuDocument> {
    const parsed = parseFeishuDocUrl(input);

    if (parsed.type === "docx" || parsed.type === "doc") {
      return {
        type: parsed.type,
        token: parsed.token,
        source: parsed
      };
    }

    if (parsed.type === "wiki") {
      const nodeResponse = await this.client.get<WikiNodeResponse>("/open-apis/wiki/v2/spaces/get_node", {
        token: parsed.token
      });
      const node = nodeResponse.node;
      if (!node?.obj_token || !node.obj_type) {
        throw new Error(`Feishu wiki node ${parsed.token} did not resolve to a document`);
      }
      if (node.obj_type !== "docx" && node.obj_type !== "doc") {
        throw new Error(`Unsupported Feishu wiki object type: ${node.obj_type}`);
      }

      return {
        type: node.obj_type,
        token: node.obj_token,
        title: node.title,
        source: parsed,
        wikiNode: {
          spaceId: node.space_id,
          nodeToken: node.node_token ?? parsed.token,
          objToken: node.obj_token,
          objType: node.obj_type
        }
      };
    }

    throw new Error("Cannot determine Feishu document type from token. Please provide a docx/doc/wiki URL.");
  }
}

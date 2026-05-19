import type { FeishuBlock, FeishuTextElement } from "./block-types.js";
import { FeishuClient } from "./client.js";

const HEADING_LEVELS: Record<number, number> = {
  3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9,
};

type BlockMap = Map<string, FeishuBlock>;

export async function renderBlocksToMarkdown(
  blocks: FeishuBlock[],
  documentToken: string,
  client: FeishuClient
): Promise<string> {
  const blockMap: BlockMap = new Map();
  for (const block of blocks) {
    blockMap.set(block.block_id, block);
  }

  const rootBlock = blocks.find((b) => b.block_type === 1);
  if (!rootBlock) {
    const results = await Promise.all(
      blocks.map((b) => renderSingleBlock(b, blockMap, documentToken, client))
    );
    return results.join("\n\n");
  }

  const lines: string[] = [];
  await renderBlockTree(rootBlock, blockMap, documentToken, client, lines);

  return lines.join("\n");
}

async function renderBlockTree(
  block: FeishuBlock,
  blockMap: BlockMap,
  documentToken: string,
  client: FeishuClient,
  lines: string[]
): Promise<void> {
  const content = await renderSingleBlock(block, blockMap, documentToken, client);
  if (content) {
    lines.push(content);
  }

  const childIds = block.children ?? [];
  for (const childId of childIds) {
    const child = blockMap.get(childId);
    if (!child) continue;

    await renderBlockTree(child, blockMap, documentToken, client, lines);
  }
}

async function renderSingleBlock(
  block: FeishuBlock,
  blockMap: BlockMap,
  documentToken: string,
  client: FeishuClient
): Promise<string> {
  switch (block.block_type) {
    case 1: return renderPage(block);
    case 2: return renderTextBlock(block);
    case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: case 11:
      return renderHeading(block);
    case 12: return renderBullet(block);
    case 13: return renderOrdered(block);
    case 14: return renderCode(block);
    case 15: return renderQuote(block);
    case 16: return renderTodo(block);
    case 18: return renderCallout(block);
    case 21: return "---";
    case 27: return await renderImage(block, client);
    case 30: return renderSheet(block);
    case 22: return renderFile(block);
    case 28: return renderIframe(block);
    case 23: return await renderGrid(block, blockMap, documentToken, client);
    case 34: return renderTable(block);
    default: return `[未知块类型 ${block.block_type}]`;
  }
}

function renderPage(block: FeishuBlock): string {
  const elements = block.page?.elements ?? [];
  const text = renderTextElements(elements);
  return text ? `# ${text}` : "";
}

function renderTextBlock(block: FeishuBlock): string {
  const elements = block.text?.elements ?? [];
  return renderTextElements(elements);
}

function renderHeading(block: FeishuBlock): string {
  const level = HEADING_LEVELS[block.block_type] ?? 1;
  const prefix = "#".repeat(Math.min(level, 6));

  const headingKey = getHeadingKey(block.block_type);
  const elements = (block as any)[headingKey]?.elements ?? [];
  const text = renderTextElements(elements);

  return text ? `${prefix} ${text}` : "";
}

function getHeadingKey(blockType: number): string {
  const map: Record<number, string> = {
    3: "heading1", 4: "heading2", 5: "heading3",
    6: "heading4", 7: "heading5", 8: "heading6",
    9: "heading7", 10: "heading8", 11: "heading9",
  };
  return map[blockType] ?? "heading2";
}

function renderBullet(block: FeishuBlock): string {
  const elements = block.bullet?.elements ?? [];
  const text = renderTextElements(elements);
  return text ? `- ${text}` : "";
}

function renderOrdered(block: FeishuBlock): string {
  const elements = block.ordered?.elements ?? [];
  const text = renderTextElements(elements);
  return text ? `1. ${text}` : "";
}

function renderCode(block: FeishuBlock): string {
  const elements = block.code?.elements ?? [];
  const text = renderTextElements(elements, false);
  return `\n\`\`\`\n${text}\n\`\`\`\n`;
}

function renderQuote(block: FeishuBlock): string {
  const elements = block.quote?.elements ?? [];
  const text = renderTextElements(elements);
  return text ? `> ${text}` : "";
}

function renderTodo(block: FeishuBlock): string {
  const elements = block.todo?.elements ?? [];
  const text = renderTextElements(elements);
  const check = block.todo?.done ? "x" : " ";
  return text ? `- [${check}] ${text}` : "";
}

function renderCallout(block: FeishuBlock): string {
  const elements = block.callout?.elements ?? [];
  const text = renderTextElements(elements);
  return text ? `> **💡 ${text}**` : "";
}

async function renderImage(block: FeishuBlock, client: FeishuClient): Promise<string> {
  const imageToken = block.image?.token;
  if (!imageToken) return "[图片]";

  try {
    const { data, contentType } = await client.downloadBinary(
      `/open-apis/drive/v1/medias/${encodeURIComponent(imageToken)}/download`
    );
    const base64 = Buffer.from(data).toString("base64");
    const mime = contentType.split(";")[0].trim() || "image/png";
    return `![图片](data:${mime};base64,${base64})`;
  } catch {
    return `[图片: token=${imageToken}]`;
  }
}

function renderSheet(block: FeishuBlock): string {
  const token = block.sheet?.token ?? "";
  return `[内嵌表格: token=${token}，如需获取完整表格数据请在飞书开放平台开通 drive:export:readonly 权限]`;
}

function renderFile(block: FeishuBlock): string {
  const name = block.file?.name ?? "文件";
  return `[文件: ${name}]`;
}

function renderIframe(block: FeishuBlock): string {
  const url = block.iframe?.url ?? "";
  const title = block.iframe?.title ?? "嵌入内容";
  return url ? `[嵌入内容: ${title}](${url})` : `[嵌入内容: ${title}]`;
}

function renderTable(block: FeishuBlock): string {
  const rows = block.table?.rows ?? [];
  if (rows.length === 0) return "[空表格]";

  const headerCells = rows[0]?.cells ?? [];
  const colCount = headerCells.length;
  if (colCount === 0) return "[空表格]";

  const headerTexts = headerCells.map((cell) =>
    renderTextElements(cell.elements ?? [], false) || " "
  );
  const separator = headerTexts.map(() => "---").join(" | ");
  const headerLine = headerTexts.join(" | ");

  const bodyLines = rows.slice(1).map((row) => {
    const cells = row.cells ?? [];
    const texts = cells.map((cell) =>
      renderTextElements(cell.elements ?? [], false) || " "
    );
    return texts.join(" | ");
  });

  return `| ${headerLine} |\n| ${separator} |\n${bodyLines.map((line) => `| ${line} |`).join("\n")}`;
}

async function renderGrid(
  block: FeishuBlock,
  blockMap: BlockMap,
  documentToken: string,
  client: FeishuClient
): Promise<string> {
  const childIds = block.children ?? [];
  const columnContents: string[] = [];

  for (const childId of childIds) {
    const child = blockMap.get(childId);
    if (!child || child.block_type !== 24) continue;

    const grandChildIds = child.children ?? [];
    const columnLines: string[] = [];
    for (const grandChildId of grandChildIds) {
      const grandChild = blockMap.get(grandChildId);
      if (!grandChild) continue;
      const content = await renderSingleBlock(grandChild, blockMap, documentToken, client);
      if (content) columnLines.push(content);
    }
    columnContents.push(columnLines.join("\n\n"));
  }

  return columnContents.join("\n\n---\n\n");
}

function renderTextElements(elements: FeishuTextElement[], applyStyles = true): string {
  return elements
    .map((el) => renderTextElement(el, applyStyles))
    .join("");
}

function renderTextElement(el: FeishuTextElement, applyStyles: boolean): string {
  if (el.text_run) {
    const { content, text_element_style } = el.text_run;
    let text = content;

    if (applyStyles && text_element_style) {
      if (text_element_style.link?.url) {
        const url = text_element_style.link.url;
        text = `[${text}](${url})`;
      }
      if (text_element_style.bold) {
        text = `**${text}**`;
      }
      if (text_element_style.italic) {
        text = `*${text}*`;
      }
      if (text_element_style.strikethrough) {
        text = `~~${text}~~`;
      }
      if (text_element_style.inline_code) {
        text = `\`${text}\``;
      }
    }

    return text;
  }

  if (el.mention) {
    return `@${el.mention.name}`;
  }

  if (el.equation) {
    return `$${el.equation.content}$`;
  }

  return "";
}
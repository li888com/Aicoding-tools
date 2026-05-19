---
name: feishu-rich-content
description: Upgrade feishu_get_doc_content tool to use Blocks API + rich Markdown rendering for tables, images, and links
metadata:
  type: project
---

# Feishu Rich Content Design

## Problem

The current `feishu_get_doc_content` tool uses the `raw_content` API which loses rich content:
- **Tables**: Inline sheet blocks (block_type 30) are completely dropped
- **Images**: Replaced with "image.png" placeholder
- **Links**: Flattened into plain text, losing link URLs

## Solution

Replace `raw_content` API with the Blocks API, then render blocks to rich Markdown.

## API Findings

| Feature | API | Status |
|---------|-----|--------|
| Document structure | `GET /docx/v1/documents/:token/blocks` | Works (paginated) |
| Image download | `GET /drive/v1/medias/:token/download` | Works, returns binary |
| Inline sheet data | Sheets API with inline token | NOTEXIST (token format incompatible) |
| Export (docx/pdf) | `POST /drive/v1/export_tasks` | Requires `drive:export:readonly` permission (not enabled) |
| Docx asset API | `GET /docx/v1/documents/:id/blocks/:bid/assets/:key` | 404 (use Drive medias instead) |

## Architecture

### New Files

1. **`src/integrations/feishu/block-types.ts`** - TypeScript type definitions for all Feishu block types (Page, Text, Heading, Image, Sheet, etc.)
2. **`src/integrations/feishu/renderer.ts`** - Block tree → Markdown renderer
3. **Update `src/integrations/feishu/docs.ts`** - Add `getBlocks()` and `getRichContent()` methods
4. **Update `src/integrations/feishu/client.ts`** - Add `downloadBinary()` method for image downloads

### Block Type Mapping (key types)

| block_type | Name | Markdown Output |
|------------|------|-----------------|
| 1 | Page | Title heading `# {title}` |
| 2 | Text | Paragraph with inline formatting |
| 3-11 | Heading1-9 | `#` through `#########` |
| 12 | Bullet | `- item` |
| 13 | Ordered | `1. item` |
| 14 | Code | Fenced code block |
| 15 | Quote | `> quote` |
| 16 | Todo | `- [ ] / - [x] item` |
| 21 | Divider | `---` |
| 27 | Image | `![alt](base64)` or `[图片: {token}]` if download fails |
| 30 | Sheet | `[内嵌表格 token={token}]` (data not accessible via API) |

### Inline Text Elements

Text runs (`text_run`) contain:
- `content`: the text
- `text_element_style`: bold, italic, strikethrough, inline_code, underline
- `link`: optional URL property

The renderer will:
- Bold → `**text**`
- Italic → `*text*`
- Strikethrough → `~~text~~`
- Inline code → `` `text` ``
- Link → `[text](url)`

### Image Handling

1. Extract `image.token` from image block
2. Download via `GET /open-apis/drive/v1/medias/{token}/download`
3. Convert to base64
4. Determine MIME type from response `content-type` header
5. Embed as `![图片](data:image/png;base64,{base64})`
6. On download failure: fall back to `[图片: token={token}]`

### Sheet (Inline Table) Handling

The inline sheet (block_type 30) token format (`DbArsPOSqhRPt4t3zNzctlI9nQc_E6Ud16`) is incompatible with the standalone Sheets API. Two strategies:

1. **Immediate**: Render placeholder `[内嵌表格: token={token}，如需获取完整表格数据请在飞书开放平台开通 drive:export:readonly 权限]`
2. **Future enhancement**: When `drive:export:readonly` is enabled, use the export API to get the full document content including table data

### Link Handling

Links appear as a `link` property on `text_run.text_element_style`. The renderer checks for `link` and wraps text as `[text](url)`.

If a text_run has both bold AND link, render as `**[text](url)**`.

### Pagination

The Blocks API returns `has_more` and `page_token`. The `getBlocks()` method loops until all blocks are collected.

### Block Tree Construction

Blocks are returned as a flat list with `parent_id` and `children` (list of child block_ids). The renderer:
1. Collects all blocks into a Map by block_id
2. Starting from the page block (root), recursively renders children in order
3. Respects the `children` array ordering for correct document structure

## Tool Changes

**`feishu_get_doc_content`**: Changed from `getRawContent()` to `getRichContent()` which uses Blocks API + Markdown rendering. The `structuredContent` response includes `format: "markdown"` instead of raw text.

## Error Handling

- Image download failure → placeholder text
- Blocks API pagination failure → partial content with warning
- Wiki resolution failure → propagated error (same as current)
- Legacy `doc` type (not `docx`) → still uses `raw_content` API (Blocks API only works for docx)

## Testing

- Verify with `https://sbtjt.feishu.cn/wiki/JC08wrjcIiOgT2kHmYYcXnTQn5e` (contains text, table, image)
- Expected output: Heading + text + image (base64) + table placeholder
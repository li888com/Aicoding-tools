import "dotenv/config";
import { FeishuDocsService } from "../src/integrations/feishu/docs.js";

const input = process.argv[2];

if (!input) {
  throw new Error("Usage: npm run test:feishu -- <feishu-doc-url>");
}

const service = new FeishuDocsService();
const parsed = service.parse(input);
console.log("parsed:", JSON.stringify(parsed, null, 2));

const meta = await service.getMeta(input);
console.log("meta:", JSON.stringify(meta, null, 2));

const result = await service.getRawContent(input);
console.log(
  "content:",
  JSON.stringify(
    {
      type: result.document.type,
      token: result.document.token,
      title: result.document.title,
      wikiNode: result.document.wikiNode,
      contentLength: result.content.length,
      preview: result.content.slice(0, 500)
    },
    null,
    2
  )
);

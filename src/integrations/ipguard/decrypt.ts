import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { access } from "node:fs/promises";
import { getIpGuardConfig } from "../../config.js";
import { IpGuardClient } from "./client.js";
import type { DecryptResult } from "./types.js";

const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "md", "json", "xml", "html", "css", "js", "ts",
  "py", "java", "yaml", "yml", "log", "ini", "cfg", "conf",
  "sh", "bat", "toml", "env", "gitignore", "editorconfig",
]);

export class FileDecryptService {
  private readonly client: IpGuardClient;

  constructor(config = getIpGuardConfig()) {
    this.client = new IpGuardClient(config);
  }

  async decryptFile(filePath: string): Promise<DecryptResult> {
    await this.validateFileExists(filePath);

    const loginId = await this.client.login();
    const fileObj = await this.client.upload(loginId, filePath);
    const isEncrypted = await this.client.checkEncrypted(loginId, fileObj);

    let resultPath: string;
    if (isEncrypted) {
      await this.client.triggerDecrypt(loginId, fileObj);
      resultPath = await this.client.downloadDecrypted(loginId, fileObj, filePath);
    } else {
      resultPath = filePath;
    }

    const ext = extname(resultPath).slice(1).toLowerCase();
    const isText = TEXT_EXTENSIONS.has(ext);

    if (isText) {
      const content = await readFile(resultPath, "utf-8");
      return {
        type: "text",
        content,
        originalFilePath: filePath,
        wasEncrypted: isEncrypted,
      };
    }

    return {
      type: "binary",
      decryptedFilePath: resultPath,
      originalFilePath: filePath,
      wasEncrypted: isEncrypted,
    };
  }

  private async validateFileExists(filePath: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
  }
}
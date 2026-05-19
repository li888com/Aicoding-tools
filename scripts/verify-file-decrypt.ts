import { FileDecryptService } from "../src/integrations/ipguard/decrypt.js";

async function verify(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx scripts/verify-file-decrypt.ts <file-path>");
    process.exit(1);
  }

  console.log(`Decrypting file: ${filePath}`);
  try {
    const service = new FileDecryptService();
    const result = await service.decryptFile(filePath);

    console.log("\nDecrypt result:");
    console.log(JSON.stringify(result, null, 2));

    if (result.type === "text" && result.content) {
      console.log("\nContent preview (first 500 chars):");
      console.log(result.content.slice(0, 500));
    } else if (result.type === "binary" && result.decryptedFilePath) {
      console.log(`\nDecrypted file saved to: ${result.decryptedFilePath}`);
    }

    console.log("\nVerification PASSED");
  } catch (error) {
    console.error("\nVerification FAILED:", error);
    process.exit(1);
  }
}

verify();
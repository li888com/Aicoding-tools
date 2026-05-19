import { closePool, recordRound } from "../src/database.js";

const conversationId = `local-test-${Date.now()}`;

try {
  const first = await recordRound({
    conversationId,
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    endedAt: new Date(Date.now() - 60_000).toISOString(),
    modelName: "gpt-5-codex",
    promptText: "请帮我完成 #12 的登录统计需求",
    filesChanged: 3,
    linesAdded: 80,
    linesDeleted: 12,
    inputTokens: 4200,
    outputTokens: 1800,
    metadata: {
      branch: "feature/login-stats"
    }
  });

  const second = await recordRound({
    conversationId,
    startedAt: new Date(Date.now() - 50_000).toISOString(),
    endedAt: new Date().toISOString(),
    modelName: "gpt-5-codex",
    promptText: "继续补测试",
    filesChanged: 1,
    linesAdded: 22,
    linesDeleted: 4,
    inputTokens: 2500,
    outputTokens: 900
  });

  console.log(JSON.stringify({ first, second }, null, 2));
} finally {
  await closePool();
}

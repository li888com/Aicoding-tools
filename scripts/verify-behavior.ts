import { closePool, recordRound } from "../src/database.js";

type Expected = {
  requirementId: number | null;
  requirementSource: "prompt" | "context" | "empty";
};

function assertRecorded(
  label: string,
  actual: Awaited<ReturnType<typeof recordRound>>,
  expected: Expected
): void {
  if (
    actual.requirementId !== expected.requirementId ||
    actual.requirementSource !== expected.requirementSource
  ) {
    throw new Error(
      `${label} failed: expected ${JSON.stringify(expected)}, got ${JSON.stringify({
        requirementId: actual.requirementId,
        requirementSource: actual.requirementSource
      })}`
    );
  }
}

const conversationId = `verify-${Date.now()}`;
const newConversationId = `verify-empty-${Date.now()}`;
const now = Date.now();

try {
  const empty = await recordRound({
    conversationId: newConversationId,
    startedAt: new Date(now - 300_000).toISOString(),
    endedAt: new Date(now - 280_000).toISOString(),
    modelName: "verify-model",
    promptText: "没有需求编号的新会话",
    linesAdded: 1,
    inputTokens: 10,
    outputTokens: 5
  });
  assertRecorded("new conversation without requirement id", empty, {
    requirementId: null,
    requirementSource: "empty"
  });

  const fromPrompt = await recordRound({
    conversationId,
    startedAt: new Date(now - 250_000).toISOString(),
    endedAt: new Date(now - 220_000).toISOString(),
    modelName: "verify-model",
    promptText: "实现需求#12 的统计需求",
    linesAdded: 10,
    linesDeleted: 2,
    inputTokens: 100,
    outputTokens: 50
  });
  assertRecorded("prompt requirement id", fromPrompt, {
    requirementId: 12,
    requirementSource: "prompt"
  });

  const fromContext = await recordRound({
    conversationId,
    startedAt: new Date(now - 200_000).toISOString(),
    endedAt: new Date(now - 170_000).toISOString(),
    modelName: "verify-model",
    promptText: "继续补测试，不写编号",
    linesAdded: 5,
    linesDeleted: 1,
    inputTokens: 80,
    outputTokens: 30
  });
  assertRecorded("context requirement id", fromContext, {
    requirementId: 12,
    requirementSource: "context"
  });

  const switchedPrompt = await recordRound({
    conversationId,
    startedAt: new Date(now - 150_000).toISOString(),
    endedAt: new Date(now - 120_000).toISOString(),
    modelName: "verify-model",
    promptText: "切到 #34 的问题",
    linesAdded: 7,
    inputTokens: 90,
    outputTokens: 35
  });
  assertRecorded("switched prompt requirement id", switchedPrompt, {
    requirementId: 34,
    requirementSource: "prompt"
  });

  const switchedContext = await recordRound({
    conversationId,
    startedAt: new Date(now - 100_000).toISOString(),
    endedAt: new Date(now - 80_000).toISOString(),
    modelName: "verify-model",
    promptText: "继续这个问题",
    linesAdded: 3,
    inputTokens: 60,
    outputTokens: 20
  });
  assertRecorded("switched context requirement id", switchedContext, {
    requirementId: 34,
    requirementSource: "context"
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        conversationId,
        newConversationId,
        checks: [empty, fromPrompt, fromContext, switchedPrompt, switchedContext]
      },
      null,
      2
    )
  );
} finally {
  await closePool();
}

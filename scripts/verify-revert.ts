import { closePool, recordRound, recordRoundRevert } from "../src/database.js";
import * as localStorage from "../src/local-storage.js";

const conversationId = `verify-revert-${Date.now()}`;
const now = Date.now();

try {
  const round = await recordRound({
    conversationId,
    startedAt: new Date(now - 120_000).toISOString(),
    endedAt: new Date(now - 90_000).toISOString(),
    modelName: "verify-model",
    promptText: "实现 #56 的待撤销改动",
    filesChanged: 2,
    linesAdded: 20,
    linesDeleted: 4,
    inputTokens: 100,
    outputTokens: 50
  });

  const revert = await recordRoundRevert({
    conversationId,
    targetRoundId: round.id,
    revertedAt: new Date(now - 30_000).toISOString(),
    modelName: "verify-model",
    promptText: "撤销上一轮代码改动",
    reason: "verification",
    filesChanged: 2,
    linesAdded: 4,
    linesDeleted: 20,
    inputTokens: 80,
    outputTokens: 30,
    metadata: {
      client: "verify-script"
    }
  });

  const revertRow = await localStorage.getRoundRevertByTarget(round.id);
  if (!revertRow) {
    throw new Error(`Expected revert record for round ${round.id}`);
  }

  const rounds = await localStorage.getRoundsByConversation(conversationId);
  const reverts = await localStorage.getRoundReverts();
  const revertedIds = new Set(reverts.map((row) => row.targetRoundId));
  const effectiveRounds = rounds.filter((row) => !revertedIds.has(row.id));
  if (effectiveRounds.some((row) => row.id === round.id)) {
    throw new Error(`Round ${round.id} should be excluded from effective rounds`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        round,
        revert,
        effectiveRoundExcluded: true
      },
      null,
      2
    )
  );
} finally {
  await closePool();
}

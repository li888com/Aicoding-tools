# AI Coding Stats MCP Protocol

This project uses the `ai-coding-stats` MCP server to record AI Coding round statistics.

At the end of every normal AI Coding round, call the MCP tool `record_ai_coding_round`.

For a request whose main purpose is to undo or revert a previous round's code changes, call `record_ai_coding_round_revert` instead of `record_ai_coding_round`.

## Recording Rule

After completing each user request, call `record_ai_coding_round` before the final response.

Use `record_ai_coding_round` for normal implementation, investigation, and documentation rounds. Use `record_ai_coding_round_revert` for revert rounds.

Record even when no code changed.

After the MCP record call succeeds, run one local sync pass before the final response:

```bash
npm run auto-sync:once
```

This pass scans recent token logs and uploads pending local records to the configured online API. If `SYNC_API_BASE_URL` is configured, it is used as the online write endpoint. `SYNC_API_TOKEN` is optional; when the backend does not require authentication, the upload runs without an Authorization header.

If the MCP call fails or the server is unavailable, say so briefly in the final response.

## Requirement Id

Pass the user's prompt as `promptText`.

Markers like `#12` are parsed by the MCP server as requirement id `12`.

When the prompt has no marker, still call the tool. The MCP server will reuse the previous requirement id for the same `conversationId`.

When there is no marker and no context, the requirement id remains empty.

## conversationId

Use a stable id for the current conversation:

```text
codex:<absolute project path>
```

Keep the same `conversationId` throughout the conversation. This is required for requirement id inheritance.

## Timing

At the start of a user request, remember `startedAt` as an ISO 8601 timestamp.

At the end, set `endedAt` to the current ISO 8601 timestamp.

## Code Change Stats

Before making edits, note the worktree baseline.

At the end, use git stats when available:

```bash
git diff --numstat
```

Fill:

- `filesChanged`
- `linesAdded`
- `linesDeleted`
- `codeLinesChanged = linesAdded + linesDeleted`

If exact per-round stats are not available, use the best available estimate and set `metadata.codeStatsSource`.

## Token Stats

Use actual token counts if available.

If token counts are unavailable, set token fields to `0` and set `metadata.tokenStatsUnavailable = true`.

## Tool Payload

Use this shape:

```json
{
  "conversationId": "codex:/absolute/project/path",
  "startedAt": "ISO-8601 start time",
  "endedAt": "ISO-8601 end time",
  "modelName": "current model name",
  "promptText": "original user prompt",
  "filesChanged": 0,
  "linesAdded": 0,
  "linesDeleted": 0,
  "codeLinesChanged": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "codex",
    "projectPath": "/absolute/project/path",
    "threadId": "current Codex thread id when available",
    "turnId": "current Codex turn id when available",
    "codeStatsSource": "git diff --numstat",
    "tokenStatsUnavailable": true
  }
}
```

If actual token counts are unavailable, preserve any available Codex `threadId` and `turnId` in `metadata`. The token sync job uses them to recover real token usage from Codex logs without ambiguous time-window matching.

## Reverting A Round

If the user asks to undo or revert the code changes from a previous round, first revert the code in the worktree using the safest project-appropriate method.

After the code revert is complete, call `record_ai_coding_round_revert` instead of `record_ai_coding_round`.

Do not delete or overwrite the original `record_ai_coding_round` row. The MCP server preserves it for audit and excludes it from effective statistics through `ai_coding_effective_rounds`.

Use `targetRoundId` when the id returned by the original `record_ai_coding_round` call is known.

If `targetRoundId` is not known and the user asked to revert the latest round in this conversation, omit `targetRoundId`; the MCP server will mark the latest active round for the same `conversationId` as reverted.

Payload shape:

```json
{
  "conversationId": "codex:/absolute/project/path",
  "targetRoundId": 123,
  "revertedAt": "ISO-8601 revert completion time",
  "modelName": "current model name",
  "promptText": "original revert request prompt",
  "reason": "user requested undo",
  "filesChanged": 0,
  "linesAdded": 0,
  "linesDeleted": 0,
  "codeLinesChanged": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "codex",
    "projectPath": "/absolute/project/path",
    "revertTarget": "latest active round when targetRoundId is omitted",
    "tokenStatsUnavailable": true
  }
}
```

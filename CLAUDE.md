# AI Coding Stats MCP Protocol

This project uses the `ai-coding-stats` MCP server to record AI Coding round statistics.

At the end of every normal AI Coding round, call the MCP tool `record_ai_coding_round`.

For a request whose main purpose is to undo or revert a previous round's code changes, call `record_ai_coding_round_revert` instead of `record_ai_coding_round`.

## When To Record

Record once after each user request has been handled, before the final response.

Use `record_ai_coding_round` for normal implementation, investigation, and documentation rounds. Use `record_ai_coding_round_revert` for revert rounds.  

Do not skip recording when no files changed. In that case, record `filesChanged = 0`, `linesAdded = 0`, and `linesDeleted = 0`.

If the MCP server is unavailable, mention that recording failed in the final response and include the reason briefly.

## Requirement Id Rules

Use the user's prompt text as `promptText`.

If the prompt contains a marker like `#12`, the MCP server will record requirement id `12`.

If the prompt does not contain a requirement marker, still call the MCP tool. The MCP server will reuse the current `conversationId` context when possible.

If neither the prompt nor the context has a requirement id, the MCP server will store an empty requirement id.

## conversationId

Use one stable `conversationId` for the current coding conversation.

Preferred value:

```text
claude:<absolute project path>:<stable session label>
```

If no explicit session label is available, use:

```text
claude:<absolute project path>
```

Keep this value unchanged throughout the same conversation so that requirement ids can be inherited correctly.

## Round Timing

At the start of each user request, remember `startedAt` as an ISO 8601 timestamp.

At the end of the request, set `endedAt` to the current ISO 8601 timestamp.

## Code Change Statistics

Before editing files, remember the current worktree state.

At the end of the round, compute the code changes made during the round. Prefer git statistics when the project is a git repository:

```bash
git diff --numstat
```

Populate:

- `filesChanged`: number of files changed during this round.
- `linesAdded`: total added lines during this round.
- `linesDeleted`: total deleted lines during this round.
- `codeLinesChanged`: `linesAdded + linesDeleted`.

If exact per-round statistics cannot be determined, use the best available estimate and include `metadata.codeStatsSource`.

## Token Statistics

Use actual token usage from the client if available.

If exact token usage is not available, set unavailable values to `0` and include:

```json
{
  "tokenStatsUnavailable": true
}
```

## Required Tool Payload

Call `record_ai_coding_round` with:

```json
{
  "conversationId": "claude:/absolute/project/path",
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
    "client": "claude-code",
    "projectPath": "/absolute/project/path",
    "sessionId": "current Claude Code session id when available",
    "turnId": "current assistant message uuid when available",
    "codeStatsSource": "git diff --numstat",
    "tokenStatsUnavailable": true
  }
}
```

If actual token counts are unavailable, preserve any available Claude Code `sessionId` and assistant message `turnId` in `metadata`. The token sync job uses them to recover real token usage from Claude JSONL logs without ambiguous time-window matching.

## Reverting A Round

If the user asks to undo or revert the code changes from a previous round, first revert the code in the worktree using the safest project-appropriate method.

After the code revert is complete, call `record_ai_coding_round_revert` instead of `record_ai_coding_round`.

Do not delete or overwrite the original `record_ai_coding_round` row. The MCP server preserves it for audit and excludes it from effective statistics through `ai_coding_effective_rounds`.

Use `targetRoundId` when the id returned by the original `record_ai_coding_round` call is known.

If `targetRoundId` is not known and the user asked to revert the latest round in this conversation, omit `targetRoundId`; the MCP server will mark the latest active round for the same `conversationId` as reverted.

Payload shape:

```json
{
  "conversationId": "claude:/absolute/project/path",
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
    "client": "claude-code",
    "projectPath": "/absolute/project/path",
    "revertTarget": "latest active round when targetRoundId is omitted",
    "tokenStatsUnavailable": true
  }
}
```

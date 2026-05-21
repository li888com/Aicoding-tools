-- AI coding turn upload tables.
-- MySQL 8.x, utf8mb4.

CREATE TABLE ai_coding_turns (
  id BIGINT NOT NULL PRIMARY KEY COMMENT 'Primary key, snowflake id',
  turn_id VARCHAR(128) NOT NULL COMMENT 'Local turn id',
  idempotency_key VARCHAR(180) NOT NULL COMMENT 'Upload idempotency key',
  conversation_id VARCHAR(512) DEFAULT NULL COMMENT 'Conversation id',

  employee_id VARCHAR(64) NOT NULL COMMENT 'Employee id',
  user_name VARCHAR(128) DEFAULT NULL COMMENT 'User name',
  team_id VARCHAR(128) DEFAULT NULL COMMENT 'Team id',

  tool VARCHAR(64) NOT NULL COMMENT 'AI tool, e.g. codex/claude/vscode',
  model_name VARCHAR(128) DEFAULT NULL COMMENT 'Model name',
  project_path VARCHAR(1024) DEFAULT NULL COMMENT 'Local project path',
  project_name VARCHAR(255) DEFAULT NULL COMMENT 'Local project name',
  git_branch VARCHAR(255) DEFAULT NULL COMMENT 'Git branch',
  commit_before VARCHAR(128) DEFAULT NULL COMMENT 'Start commit',
  commit_after VARCHAR(128) DEFAULT NULL COMMENT 'End commit',

  started_at DATETIME(3) NOT NULL COMMENT 'Turn start time',
  ended_at DATETIME(3) DEFAULT NULL COMMENT 'Turn end time',

  files_changed INT NOT NULL DEFAULT 0 COMMENT 'Changed file count',
  lines_added INT NOT NULL DEFAULT 0 COMMENT 'Added lines',
  lines_deleted INT NOT NULL DEFAULT 0 COMMENT 'Deleted lines',
  code_lines_changed INT NOT NULL DEFAULT 0 COMMENT 'Added + deleted lines',

  token_status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending/completed/unavailable/not_found/needs_review/conflict',
  token_source VARCHAR(64) DEFAULT NULL COMMENT 'Token source',
  input_tokens BIGINT DEFAULT NULL COMMENT 'Input tokens',
  output_tokens BIGINT DEFAULT NULL COMMENT 'Output tokens',
  total_tokens BIGINT DEFAULT NULL COMMENT 'Total tokens',
  cached_tokens BIGINT DEFAULT NULL COMMENT 'Cached tokens',
  reasoning_tokens BIGINT DEFAULT NULL COMMENT 'Reasoning tokens',
  tool_tokens BIGINT DEFAULT NULL COMMENT 'Tool tokens',

  binding_level VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT 'demand/task/none',
  demand_id VARCHAR(64) DEFAULT NULL COMMENT 'GPM demand id',
  demand_code VARCHAR(64) DEFAULT NULL COMMENT 'GPM demand code',
  demand_name VARCHAR(512) DEFAULT NULL COMMENT 'GPM demand name',
  phase_name VARCHAR(128) DEFAULT NULL COMMENT 'Demand phase name',
  project_code VARCHAR(128) DEFAULT NULL COMMENT 'GPM project code',
  project_name_bound VARCHAR(512) DEFAULT NULL COMMENT 'GPM project name',
  task_id VARCHAR(64) DEFAULT NULL COMMENT 'Reserved task id',
  task_code VARCHAR(64) DEFAULT NULL COMMENT 'Reserved task code',
  task_name VARCHAR(512) DEFAULT NULL COMMENT 'Reserved task name',

  code_stats_source VARCHAR(128) DEFAULT NULL COMMENT 'Code stats source',
  code_stats_precision VARCHAR(64) DEFAULT NULL COMMENT 'Code stats precision',
  upload_status VARCHAR(32) NOT NULL DEFAULT 'uploaded' COMMENT 'Upload status',
  metadata_json JSON DEFAULT NULL COMMENT 'Metadata json',

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uk_ai_coding_turn_id (turn_id),
  UNIQUE KEY uk_ai_coding_idempotency_key (idempotency_key),
  KEY idx_ai_coding_employee_time (employee_id, started_at),
  KEY idx_ai_coding_demand_time (demand_id, started_at),
  KEY idx_ai_coding_demand_code_time (demand_code, started_at),
  KEY idx_ai_coding_tool_time (tool, started_at),
  KEY idx_ai_coding_token_status (token_status),
  KEY idx_ai_coding_project_code_time (project_code, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI coding turn statistics';

CREATE TABLE ai_coding_token_events (
  id BIGINT NOT NULL PRIMARY KEY COMMENT 'Primary key, snowflake id',
  turn_id VARCHAR(128) NOT NULL COMMENT 'Related turn id',
  source_event_id VARCHAR(180) NOT NULL COMMENT 'Token event idempotency id',
  tool VARCHAR(64) NOT NULL COMMENT 'AI tool',
  token_source VARCHAR(64) NOT NULL COMMENT 'Token source',

  occurred_at DATETIME(3) DEFAULT NULL COMMENT 'Token event time',
  input_tokens BIGINT DEFAULT NULL COMMENT 'Input tokens',
  output_tokens BIGINT DEFAULT NULL COMMENT 'Output tokens',
  total_tokens BIGINT DEFAULT NULL COMMENT 'Total tokens',
  cached_tokens BIGINT DEFAULT NULL COMMENT 'Cached tokens',
  reasoning_tokens BIGINT DEFAULT NULL COMMENT 'Reasoning tokens',
  tool_tokens BIGINT DEFAULT NULL COMMENT 'Tool tokens',

  match_strategy VARCHAR(64) DEFAULT NULL COMMENT 'Match strategy',
  confidence VARCHAR(32) DEFAULT NULL COMMENT 'Match confidence',
  raw_json JSON DEFAULT NULL COMMENT 'Raw or summary json',

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE KEY uk_ai_coding_source_event_id (source_event_id),
  KEY idx_ai_coding_token_turn_id (turn_id),
  KEY idx_ai_coding_token_tool_time (tool, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI coding token backfill event';

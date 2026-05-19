CREATE TABLE IF NOT EXISTS ai_coding_conversations (
  conversation_id VARCHAR(128) NOT NULL PRIMARY KEY,
  current_requirement_id BIGINT UNSIGNED NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_round_id BIGINT UNSIGNED NULL,
  KEY idx_current_requirement_id (current_requirement_id),
  KEY idx_last_seen_at (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_coding_requirements (
  requirement_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  title VARCHAR(255) NULL,
  project_name VARCHAR(255) NULL,
  gpm_number VARCHAR(128) NULL,
  status ENUM('active','done','archived') NOT NULL DEFAULT 'active',
  description TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_project_name (project_name),
  KEY idx_gpm_number (gpm_number),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_coding_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(128) NOT NULL,
  requirement_id BIGINT UNSIGNED NULL,
  requirement_source ENUM('prompt', 'context', 'empty') NOT NULL,
  model_name VARCHAR(128) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NOT NULL,
  duration_ms BIGINT UNSIGNED GENERATED ALWAYS AS (TIMESTAMPDIFF(MICROSECOND, started_at, ended_at) DIV 1000) STORED,
  prompt_text TEXT NULL,
  files_changed INT UNSIGNED NULL,
  lines_added INT UNSIGNED NOT NULL DEFAULT 0,
  lines_deleted INT UNSIGNED NOT NULL DEFAULT 0,
  code_lines_changed INT UNSIGNED NOT NULL DEFAULT 0,
  input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  token_source ENUM('mcp_payload','codex_log','claude_jsonl','manual','unavailable') NOT NULL DEFAULT 'mcp_payload',
  token_synced_at DATETIME(3) NULL,
  token_sync_status ENUM('pending','synced','not_found','ambiguous','failed') NOT NULL DEFAULT 'pending',
  token_sync_note VARCHAR(512) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ai_coding_rounds_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES ai_coding_conversations(conversation_id)
    ON DELETE CASCADE,
  CHECK (ended_at >= started_at),
  KEY idx_requirement_started_at (requirement_id, started_at),
  KEY idx_conversation_started_at (conversation_id, started_at),
  KEY idx_model_started_at (model_name, started_at),
  KEY idx_token_sync_status (token_sync_status),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_coding_round_reverts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_round_id BIGINT UNSIGNED NOT NULL,
  conversation_id VARCHAR(128) NOT NULL,
  model_name VARCHAR(128) NOT NULL,
  prompt_text TEXT NULL,
  reverted_at DATETIME(3) NOT NULL,
  reason VARCHAR(512) NULL,
  files_changed INT UNSIGNED NULL,
  lines_added INT UNSIGNED NOT NULL DEFAULT 0,
  lines_deleted INT UNSIGNED NOT NULL DEFAULT 0,
  code_lines_changed INT UNSIGNED NOT NULL DEFAULT 0,
  input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ai_coding_round_reverts_target
    FOREIGN KEY (target_round_id)
    REFERENCES ai_coding_rounds(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ai_coding_round_reverts_conversation
    FOREIGN KEY (conversation_id)
    REFERENCES ai_coding_conversations(conversation_id)
    ON DELETE CASCADE,
  UNIQUE KEY uk_target_round_id (target_round_id),
  KEY idx_conversation_reverted_at (conversation_id, reverted_at),
  KEY idx_reverted_at (reverted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_coding_token_usage_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  round_id BIGINT UNSIGNED NULL,
  client ENUM('codex','claude-code') NOT NULL,
  source_path VARCHAR(1024) NOT NULL,
  source_event_id VARCHAR(256) NULL,
  conversation_id VARCHAR(256) NULL,
  turn_id VARCHAR(256) NULL,
  model_name VARCHAR(128) NULL,
  started_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  raw_event JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ai_coding_token_usage_events_round
    FOREIGN KEY (round_id)
    REFERENCES ai_coding_rounds(id)
    ON DELETE SET NULL,
  KEY idx_round_id (round_id),
  KEY idx_client_created_at (client, created_at),
  KEY idx_conversation_turn (conversation_id, turn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE OR REPLACE VIEW ai_coding_effective_rounds AS
SELECT r.*
FROM ai_coding_rounds r
LEFT JOIN ai_coding_round_reverts rr ON rr.target_round_id = r.id
WHERE rr.id IS NULL;

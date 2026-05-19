SET @schema_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_coding_rounds ADD COLUMN token_source ENUM(''mcp_payload'',''codex_log'',''claude_jsonl'',''manual'',''unavailable'') NOT NULL DEFAULT ''mcp_payload''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'ai_coding_rounds'
    AND COLUMN_NAME = 'token_source'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_coding_rounds ADD COLUMN token_synced_at DATETIME(3) NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'ai_coding_rounds'
    AND COLUMN_NAME = 'token_synced_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_coding_rounds ADD COLUMN token_sync_status ENUM(''pending'',''synced'',''not_found'',''ambiguous'',''failed'') NOT NULL DEFAULT ''pending''',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'ai_coding_rounds'
    AND COLUMN_NAME = 'token_sync_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE ai_coding_rounds ADD COLUMN token_sync_note VARCHAR(512) NULL',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'ai_coding_rounds'
    AND COLUMN_NAME = 'token_sync_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_token_sync_status ON ai_coding_rounds (token_sync_status)',
    'SELECT 1'
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'ai_coding_rounds'
    AND INDEX_NAME = 'idx_token_sync_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

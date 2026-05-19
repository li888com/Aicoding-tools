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

CREATE OR REPLACE VIEW ai_coding_effective_rounds AS
SELECT r.*
FROM ai_coding_rounds r
LEFT JOIN ai_coding_round_reverts rr ON rr.target_round_id = r.id
WHERE rr.id IS NULL;

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

INSERT IGNORE INTO ai_coding_requirements (requirement_id)
SELECT DISTINCT requirement_id
FROM ai_coding_rounds
WHERE requirement_id IS NOT NULL;

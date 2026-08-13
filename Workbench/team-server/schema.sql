CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(190) NOT NULL UNIQUE,
  display_name VARCHAR(190) NOT NULL,
  dingtalk_user_id VARCHAR(190) NOT NULL UNIQUE,
  dingtalk_union_id VARCHAR(190) NULL UNIQUE,
  department_name VARCHAR(255) NULL,
  manager_user_id VARCHAR(190) NULL,
  role ENUM('member', 'admin') NOT NULL DEFAULT 'member',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  last_synced_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_users_manager (manager_user_id),
  INDEX idx_users_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dingtalk_tokens (
  token_key VARCHAR(255) NOT NULL PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS daily_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  report_date DATE NOT NULL,
  summary TEXT NOT NULL,
  completed_items TEXT NOT NULL,
  blockers TEXT NOT NULL,
  next_actions TEXT NOT NULL,
  submitted_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_daily_report_owner_date (user_id, report_date),
  CONSTRAINT fk_daily_report_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(190) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_audit_created_at (created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

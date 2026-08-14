-- 组织多部门归属与授权范围。
-- org_members.authorized_by_identity_id 记录该成员由哪个主管账号的同步收录，
-- 供“本轮不再出现”的失效处理隔离，避免跨主管账号误伤其他可见链。
ALTER TABLE org_members ADD COLUMN authorized_by_identity_id TEXT REFERENCES identities(id);
-- 成员—部门多归属：一名成员可属于多个部门，替代 org_members.department_id 的单部门表达。
CREATE TABLE IF NOT EXISTS org_member_departments (
  identity_id TEXT NOT NULL REFERENCES identities(id),
  department_id TEXT NOT NULL REFERENCES departments(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (identity_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_org_member_departments_dept ON org_member_departments(department_id);

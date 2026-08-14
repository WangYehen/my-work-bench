-- Old goals and task links were device-scoped.  They must not be silently
-- adopted by the next DingTalk account that signs in on this machine.
ALTER TABLE goals ADD COLUMN owner_identity_id TEXT REFERENCES identities(id);
CREATE INDEX IF NOT EXISTS idx_goals_owner_period ON goals(owner_identity_id, period_start);
DELETE FROM goals WHERE owner_identity_id IS NULL;
DELETE FROM goal_work_items WHERE work_item_id IN (SELECT id FROM work_items WHERE owner_identity_id IS NULL);
DELETE FROM work_items WHERE owner_identity_id IS NULL;

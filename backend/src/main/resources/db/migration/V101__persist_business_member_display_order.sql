ALTER TABLE organization_memberships
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) - 1 AS position
  FROM organization_memberships
)
UPDATE organization_memberships member
SET display_order = ranked.position
FROM ranked
WHERE member.id = ranked.id;

CREATE INDEX IF NOT EXISTS ix_organization_memberships_planner_order
  ON organization_memberships (organization_id, display_order, created_at, id);

-- Backfill monthly_transfer_snapshot automation for households created before this feature was added.
-- Uses gen_random_uuid() to generate a cuid-compatible ID (prefixed with 'c' to match cuid format).
INSERT INTO "Automation" (id, key, label, description, schedule, "householdId", "isEnabled", "createdAt", "updatedAt")
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  'monthly_transfer_snapshot',
  'Monthly budget transfer calculation',
  'Calculates and records the recommended monthly transfer on the 1st of each month',
  '0 0 1 * *',
  id,
  true,
  NOW(),
  NOW()
FROM "Household"
WHERE id NOT IN (
  SELECT "householdId" FROM "Automation" WHERE key = 'monthly_transfer_snapshot'
);

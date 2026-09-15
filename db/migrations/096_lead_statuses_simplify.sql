-- Migration 096: Simplify the lead status taxonomy.
--
-- The old five-value pipeline (new / contacted / qualified / converted /
-- rejected) was more granular than how the team actually uses leads. The
-- new taxonomy is intentionally minimal:
--
--   new       — fresh, never touched
--   prospect  — engaged in conversation; still a candidate
--   dead      — disqualified / no longer pursuing
--   converted — system-set when /api/leads/:id/promote runs; can also
--               be unwound by /api/clients/:id/relegate-to-lead which
--               flips a freshly-spawned lead back to 'new'.
--
-- Migration strategy: widen the ENUM to the union of the OLD + NEW
-- values (so existing rows are still valid mid-migration), UPDATE the
-- old values to their new equivalents, then narrow the ENUM down to
-- just the new four. This is safe to re-apply because the second ALTER
-- is a no-op once the column already has the narrow shape.
--
-- Mapping:
--   contacted  → prospect  (was "we've reached out, awaiting reply")
--   qualified  → prospect  (was "looks viable, still pre-conversion")
--   rejected   → dead

ALTER TABLE `leads`
  MODIFY `status` ENUM(
    'new','contacted','qualified','converted','rejected',
    'prospect','dead'
  ) NOT NULL DEFAULT 'new';

UPDATE `leads` SET `status` = 'prospect' WHERE `status` IN ('contacted', 'qualified');
UPDATE `leads` SET `status` = 'dead'     WHERE `status` = 'rejected';

ALTER TABLE `leads`
  MODIFY `status` ENUM('new', 'prospect', 'dead', 'converted') NOT NULL DEFAULT 'new';

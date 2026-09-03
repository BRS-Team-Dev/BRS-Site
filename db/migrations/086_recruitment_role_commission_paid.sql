-- Migration 086: Commission-paid tracking belongs on the role, not the
-- placement.
--
-- Commission is negotiated up-front with the client when the role is
-- briefed (one role = one negotiated fee). The "paid" status tracks
-- whether the agency has received that fee from the client. It's a
-- property of the role, not of the individual candidate placed in it —
-- multiple candidates cycling through a role over time don't each
-- generate their own commission invoice.
--
-- The existing `commission_paid_*` columns on `recruitment_placements`
-- stay in place for legacy data; the UI just stops collecting / showing
-- them at placement level.

USE `builtrightstudio_cms`;

ALTER TABLE `recruitment_roles`
  ADD COLUMN `commission_paid_part` TINYINT(1) NOT NULL DEFAULT 0 AFTER `commission_value`,
  ADD COLUMN `commission_paid_full` TINYINT(1) NOT NULL DEFAULT 0 AFTER `commission_paid_part`,
  ADD COLUMN `commission_due_part`  DATE NULL AFTER `commission_paid_full`,
  ADD COLUMN `commission_due_full`  DATE NULL AFTER `commission_due_part`;

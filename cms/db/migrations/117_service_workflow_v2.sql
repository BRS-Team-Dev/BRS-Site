-- Migration 117: full 8-state service workflow + CRM task linkage.
--
-- Replaces the original 5-state enum (onboarding/pending/started/
-- ongoing/complete) introduced in 114 with an 8-state pipeline that
-- splits onboarding phase from work phase:
--
--   ── Onboarding phase ──
--     new        — record created, onboarding link not sent yet
--     onboarding — link sent / client filling form
--     submitted  — onboarding form submitted, awaiting admin approval
--     qualified  — admin approved; work scheduled
--   ── Work phase ──
--     to_do       — task created, not started
--     in_progress — task being worked on
--     done        — service delivered
--     on_hold     — paused (waiting on client, blocker, etc.)
--
-- Each onboarding-phase transition auto-creates a CRM task so the
-- admin sees the next action on the CRM Task Board (wiring is in
-- routes/services.php). When status reaches `qualified` the row
-- also auto-bumps to `to_do` so the work phase starts immediately.
--
-- Migration order matters: we MUST UPDATE old values to their new
-- mapping FIRST while the enum still accepts both, and only THEN
-- drop the old values from the enum. Otherwise MySQL blanks any
-- row whose value isn't in the new enum, losing all status data.

-- ── 1. Expand the enum to accept both old AND new values ────────
ALTER TABLE `client_service_offerings`
  MODIFY COLUMN `status` ENUM(
    'onboarding','pending','started','ongoing','complete',
    'new','submitted','qualified','to_do','in_progress','done','on_hold'
  ) NOT NULL DEFAULT 'new';

-- ── 2. Map old → new while both are valid ───────────────────────
UPDATE `client_service_offerings` SET `status` = 'submitted'   WHERE `status` = 'pending';
UPDATE `client_service_offerings` SET `status` = 'to_do'       WHERE `status` = 'started';
UPDATE `client_service_offerings` SET `status` = 'in_progress' WHERE `status` = 'ongoing';
UPDATE `client_service_offerings` SET `status` = 'done'        WHERE `status` = 'complete';
-- onboarding stays as onboarding

-- ── 3. Drop the old values from the enum ────────────────────────
ALTER TABLE `client_service_offerings`
  MODIFY COLUMN `status` ENUM(
    'new','onboarding','submitted','qualified',
    'to_do','in_progress','done','on_hold'
  ) NOT NULL DEFAULT 'new';

-- ── crm_tasks workflow ─────────────────────────────────────────
ALTER TABLE `crm_tasks`
  MODIFY COLUMN `status` ENUM('to_do','in_progress','done','on_hold')
    NOT NULL DEFAULT 'to_do';

-- New optional FK so auto-created tasks know which catalogue-attached
-- row they belong to. Cascades on delete so removing a service
-- attachment cleans up the tracking tasks too.
ALTER TABLE `crm_tasks`
  ADD COLUMN `service_client_link_id` INT UNSIGNED NULL AFTER `assignee_user_id`,
  ADD KEY `idx_crm_tasks_service_link` (`service_client_link_id`),
  ADD CONSTRAINT `fk_crm_tasks_service_link`
    FOREIGN KEY (`service_client_link_id`) REFERENCES `client_service_offerings`(`id`)
    ON DELETE CASCADE;

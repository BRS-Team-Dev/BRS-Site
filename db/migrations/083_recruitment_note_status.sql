-- Migration 083: Per-note pipeline status.
--
-- Each note on a candidate gets snapshotted with the candidate's status
-- at the time it was written, so the Notes tab can group history by
-- pipeline stage (e.g. "Interviewing notes" vs "Compliant notes"). The
-- backend POST handler reads the current candidate.status and copies it
-- into the new column on insert — UI doesn't need to send it.
--
-- For pre-existing notes (created before this migration) we backfill
-- with the candidate's CURRENT status. That's a best-effort approximation
-- because we never recorded the historical stage; HR can re-tag manually
-- via PUT if it matters.

USE `builtrightstudio_cms`;

ALTER TABLE `recruitment_candidate_notes`
  ADD COLUMN `status` ENUM(
    'new', 'interviewing', 'processing', 'compliant',
    'client_screening', 'placed', 'rejected_by_client', 'rejected_by_us'
  ) NULL AFTER `body`;

-- Backfill — assign every existing note the current candidate status.
UPDATE `recruitment_candidate_notes` n
  JOIN `recruitment_candidates` c ON c.id = n.candidate_id
  SET n.`status` = c.`status`
  WHERE n.`status` IS NULL;

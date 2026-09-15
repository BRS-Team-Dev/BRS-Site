-- Migration 114: per-client/service workflow status.
--
-- Adds a 5-state lifecycle to every client_service_offerings row so
-- admins can track where a service sits without leaving the Services
-- page. States:
--
--   onboarding → the client is mid-onboarding (form not yet submitted
--                or not yet qualified). Catalogue attaches never enter
--                this state; only onboarding-derived rows do.
--   pending    → qualified but the operations side hasn't picked it
--                up yet. Default for fresh catalogue attaches too.
--   started    → operations side has begun — first task accepted.
--   ongoing    → active delivery (most rows live here).
--   complete   → delivered + signed off.
--
-- Catalogue-attached rows (client_service_offerings) carry this column
-- directly. Onboarding-derived rows (no client_service_offerings row,
-- only an onboarding_clients + task_projects pair) have their status
-- computed in PHP from `onboarding_clients.qualified_at` + the linked
-- `task_projects.status`, so the GET /services/:id/clients endpoint
-- can return a unified value regardless of source.

ALTER TABLE `client_service_offerings`
  ADD COLUMN `status` ENUM('onboarding','pending','started','ongoing','complete')
    NOT NULL DEFAULT 'pending' AFTER `repeat_duration`;

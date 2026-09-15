-- Migration 140: forms gain the broadcast pattern already tested on
-- feedback_forms. Applies to both `form_type='standard'` and
-- `form_type='onboarding'` rows since they share the same table.
--
-- The 4-option "Attach to" model becomes:
--   - none                    (nothing set)
--   - all clients             (broadcast_to_all_clients=1)
--   - all leads               (broadcast_to_all_leads=1)
--   - service                 (service_offering_id=X)
-- Mutually exclusive; enforced at the UI + backend save layer, not
-- with a CHECK constraint (keeps rollbacks trivial).
--
-- Per-recipient invitations via `onboarding_clients.client_token`
-- stack ON TOP of whichever broadcast scope is set — they add
-- individual attach without removing broadcast reach.

ALTER TABLE `forms`
  ADD COLUMN `broadcast_to_all_clients` TINYINT(1) NOT NULL DEFAULT 0 AFTER `service_offering_id`,
  ADD COLUMN `broadcast_to_all_leads`   TINYINT(1) NOT NULL DEFAULT 0 AFTER `broadcast_to_all_clients`;

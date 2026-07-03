-- Migration 121: broadcast flags on feedback_forms.
--
-- Adds three all-or-nothing attach rules that surface a form on every
-- matching client / lead detail tab WITHOUT requiring a per-row
-- junction attach:
--
--   broadcast_to_all_clients — form appears on every client's feedback tab
--   broadcast_to_all_leads   — form appears on every lead's feedback tab
--   service_offering_id      — (already exists) form appears for every
--                              client / lead that has this service via
--                              client_service_offerings / lead_services
--
-- These are additive with the existing feedback_form_clients / _leads
-- junction (which stays for one-off manual attaches). The list-filter
-- rewrite in routes/feedback.php ORs them together.

ALTER TABLE `feedback_forms`
  ADD COLUMN `broadcast_to_all_clients` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_published`,
  ADD COLUMN `broadcast_to_all_leads`   TINYINT(1) NOT NULL DEFAULT 0 AFTER `broadcast_to_all_clients`;

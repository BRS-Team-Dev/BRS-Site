-- Migration 066: Newsletter campaigns gain a `blocks_json` column.
--
-- The compose screen is now a block-based builder (heading / paragraph /
-- image / button / divider / spacer / raw HTML). Each block has its own
-- editor; the live preview pane renders all blocks as inline-styled,
-- email-client-safe HTML. We persist BOTH the rendered body_html (used
-- at send time, no client logic needed) and the blocks_json (so a draft
-- round-trips back into the builder for further editing).
--
-- Existing drafts created with the previous textarea UI will have
-- blocks_json IS NULL — the frontend treats that as "load body_html as
-- a single 'html' raw block" so legacy drafts open cleanly.

ALTER TABLE `newsletter_campaigns`
  ADD COLUMN `blocks_json` LONGTEXT NULL AFTER `body_html`;

-- Migration 134: normalise plan taglines to ASCII-only.
--
-- Migration 132 seeded taglines that used the em-dash `--` which
-- got mojibaked (UTF-8 bytes reinterpreted as CP1252) by the default
-- mysql client charset. Migration 133 fixed user_range_label but
-- I missed tagline in the same table -- same mistake pattern.
-- This migration cleans every affected row AND rewrites the phrasing
-- so it doesn't need a special dash at all.

UPDATE `subscription_plans`
   SET tagline = '30-day free trial with full Growth features.'
 WHERE tier = 'trial';

UPDATE `subscription_plans`
   SET tagline = 'The main offer. Pay-as-you-grow with the full 6-system stack.'
 WHERE tier = 'growth';

UPDATE `subscription_plans`
   SET tagline = 'Talk to us. Custom scope, custom price.'
 WHERE tier = 'enterprise';

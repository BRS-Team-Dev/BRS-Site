-- Migration 133: re-price plans to the median of the ranges you gave,
-- and fix the encoding on user_range_label (the en-dash characters
-- from migration 132 got double-encoded through CP1252). Use plain
-- ASCII hyphens so this can't happen again regardless of client charset.
--
-- Medians (rounded to whole pounds):
--   Starter          (£99–£149)   → £124
--   Growth           (£199–£349)  → £274   ← main offer
--   Scale            (£399–£799)  → £599
--   Business         (£799–£1500) → £1150
--   Enterprise Lite  (£1500–£3500)→ £2500
--   Enterprise                    → contact sales
-- Yearly = 10 × monthly (~2 months free).

UPDATE `subscription_plans`
   SET price_monthly_cents = 12400,
       price_yearly_cents  = 124000,
       user_range_label    = '1-5 users'
 WHERE tier = 'starter';

UPDATE `subscription_plans`
   SET price_monthly_cents = 27400,
       price_yearly_cents  = 274000,
       user_range_label    = '5-10 users'
 WHERE tier = 'growth';

UPDATE `subscription_plans`
   SET price_monthly_cents = 59900,
       price_yearly_cents  = 599000,
       user_range_label    = '10-25 users'
 WHERE tier = 'scale';

UPDATE `subscription_plans`
   SET price_monthly_cents = 115000,
       price_yearly_cents  = 1150000,
       user_range_label    = '25-50 users'
 WHERE tier = 'business';

UPDATE `subscription_plans`
   SET price_monthly_cents = 250000,
       price_yearly_cents  = 2500000,
       user_range_label    = '50-100 users'
 WHERE tier = 'enterprise_lite';

UPDATE `subscription_plans`
   SET user_range_label = '100+ users'
 WHERE tier = 'enterprise';

UPDATE `subscription_plans`
   SET user_range_label = 'Up to 3 users'
 WHERE tier = 'trial';

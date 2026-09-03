-- Migration 132: canonical subscription plan catalogue.
--
-- Expands `subscription_tier` from the earlier 5-tier ENUM to the
-- final 7 tiers (adds `business` and `enterprise_lite` between scale
-- and enterprise). Creates a `subscription_plans` table that holds
-- display + pricing metadata per tier so the plan-picker UI, marketing
-- pages, and the /api/billing/stripe/subscribe endpoint can all read
-- from one source of truth.
--
-- Feature bullets are stored as JSON. Order matters (top bullet is
-- the headline), so we store them as an array not an object.
--
-- The tier ENUM ordering is significant - the "next tier" upgrade
-- ladder in users.php walks it in order, so new values are appended
-- between `scale` and `enterprise` in ladder position.

-- ── Expand the ENUM ────────────────────────────────────────
ALTER TABLE `tenants`
  MODIFY COLUMN `subscription_tier`
    ENUM('trial','starter','growth','scale','business','enterprise_lite','enterprise')
    NOT NULL DEFAULT 'trial';

-- ── Plans catalogue ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `subscription_plans` (
  `id`                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `tier`                  ENUM('trial','starter','growth','scale','business','enterprise_lite','enterprise') NOT NULL,
  `name`                  VARCHAR(80)  NOT NULL,
  `tagline`               VARCHAR(160) NULL,
  `user_range_label`      VARCHAR(30)  NULL,          -- e.g. "5-10 users"
  `max_users`             INT UNSIGNED NULL,          -- NULL = unlimited
  `price_monthly_cents`   INT NOT NULL DEFAULT 0,
  `price_yearly_cents`    INT NOT NULL DEFAULT 0,
  `currency`              CHAR(3) NOT NULL DEFAULT 'GBP',
  `is_contact_sales`      TINYINT(1) NOT NULL DEFAULT 0,
  `is_highlight`          TINYINT(1) NOT NULL DEFAULT 0,   -- "Main offer" badge
  `is_active`             TINYINT(1) NOT NULL DEFAULT 1,
  `features_json`         JSON NULL,
  `stripe_price_monthly`  VARCHAR(60) NULL,
  `stripe_price_yearly`   VARCHAR(60) NULL,
  `sort_order`            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_plans_tier` (`tier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seed the catalogue with the six bundle tiers plus trial. ─
--    Prices are the LOW end of the ranges you provided; edit any row
--    from Settings → Billing → Plan editor (super-admin) to bump.
--    Yearly = 10 × monthly (~2 months free).

INSERT INTO `subscription_plans`
  (tier, name, tagline, user_range_label, max_users,
   price_monthly_cents, price_yearly_cents, is_contact_sales, is_highlight, sort_order, features_json)
VALUES
  ('trial', 'Free Trial', '30-day free trial with full Growth features.', 'Up to 3 users', 3,
   0, 0, 0, 0, 0,
   JSON_ARRAY('30-day trial', 'Access to Growth features', 'Up to 3 users', 'Cancel anytime, no card required')),

  ('starter', 'Starter Bundle', 'Everything a small team needs to run day-to-day.', '1-5 users', 5,
   9900, 99000, 0, 0, 1,
   JSON_ARRAY('CRM: leads, clients, tasks', 'Basic forms & feedback', 'Email support', 'Custom brand theme')),

  ('growth', 'Growth Bundle', 'The main offer. Pay-as-you-grow with the full 6-system stack.', '5-10 users', 10,
   19900, 199000, 0, 1, 2,
   JSON_ARRAY('All 6 systems: CRM, HR, Recruitment, Accounting, Ops, Tasks',
              'Automated notifications & task board',
              'Priority email support',
              'API access',
              'Multi-brand theming')),

  ('scale', 'Scale Bundle', 'For teams standardising cross-department workflows.', '10-25 users', 25,
   39900, 399000, 0, 0, 3,
   JSON_ARRAY('Everything in Growth',
              'Advanced automation',
              'Onboarding session',
              'Phone support',
              'Higher upload caps')),

  ('business', 'Business Bundle', 'Multi-team operations with dedicated support.', '25-50 users', 50,
   79900, 799000, 0, 0, 4,
   JSON_ARRAY('Everything in Scale',
              'Dedicated onboarding',
              'White-label options',
              'Custom integrations',
              'Uptime SLA')),

  ('enterprise_lite', 'Enterprise Lite', 'Enterprise-grade at a fixed price.', '50-100 users', 100,
   150000, 1500000, 0, 0, 5,
   JSON_ARRAY('Everything in Business',
              'Dedicated Customer Success Manager',
              'SSO (SAML / OIDC)',
              'Advanced audit logs',
              'Contractual SLA')),

  ('enterprise', 'Enterprise', 'Talk to us. Custom scope, custom price.', '100+ users', NULL,
   0, 0, 1, 0, 6,
   JSON_ARRAY('Unlimited users',
              'Dedicated infrastructure',
              'Custom contracts & DPAs',
              'Named CSM + 24/7 support',
              'On-prem / private-cloud option'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  tagline = VALUES(tagline),
  user_range_label = VALUES(user_range_label),
  max_users = VALUES(max_users),
  price_monthly_cents = VALUES(price_monthly_cents),
  price_yearly_cents = VALUES(price_yearly_cents),
  is_contact_sales = VALUES(is_contact_sales),
  is_highlight = VALUES(is_highlight),
  sort_order = VALUES(sort_order),
  features_json = VALUES(features_json);

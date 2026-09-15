-- Page views per lead / client, for tracked links sent out by email.
--
-- A link such as  https://builtrightstudio.com/preview.html?id=2&id_type=lead
-- records one view against lead 2 on preview.html. The marketing page fires
-- a beacon (main-website/js/page-view.js) at POST /api/public-page-view,
-- which upserts here.
--
-- One row per (page, id_type, record) - the FIRST visit inserts it, every
-- later visit increments view_count and moves last_viewed_at. `page` is part
-- of the key on purpose: the same lead opening two different pages is two
-- rows, not one row whose `page` column flips to whichever was opened last.
--
-- Column naming vs the original sketch: the sketch had both a "unique id" and
-- an "id" (the lead/client id). A table cannot have two `id` columns, so the
-- row key is `id` and the lead/client id is `record_id`. "count" is
-- `view_count`, which avoids shadowing the SQL COUNT() function in queries.
--
-- Not an FK to leads/clients: the id is polymorphic (id_type decides the
-- table), and the view history should survive a record being deleted.

CREATE TABLE `page_views` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       INT UNSIGNED NOT NULL,
  -- Page file name as served, lower-cased, e.g. 'preview.html'.
  `page`            VARCHAR(120) NOT NULL,
  -- 'lead' or 'client'.
  `id_type`         VARCHAR(10)  NOT NULL,
  `record_id`       INT UNSIGNED NOT NULL,
  `view_count`      INT UNSIGNED NOT NULL DEFAULT 1,
  -- Both timestamps default on insert, so the upsert can keep its VALUES list
  -- to placeholders only (TenantPdo's INSERT rewriter mis-reads a function
  -- call inside VALUES).
  `first_viewed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_viewed_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- The upsert target. tenant_id leads so one tenant's views never collide
  -- with another's.
  UNIQUE KEY `uq_page_views_target` (`tenant_id`, `page`, `id_type`, `record_id`),
  -- "Which pages has this lead looked at?"
  KEY `idx_page_views_record` (`tenant_id`, `id_type`, `record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

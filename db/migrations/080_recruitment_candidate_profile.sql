-- Migration 080: Profile additions for recruitment candidates.
--
-- Five fields requested as the agency profile grew beyond contact + role:
--   - gender              — for D&I reporting + matching to client requirements.
--   - has_driving_license — does the candidate hold a valid licence.
--   - willing_to_drive    — separate from holding a licence: are they willing
--                            to drive to sites for work (the rejection case
--                            on Ahmed Ibrahim ID 15 was exactly this — strong
--                            tech fit but declined UK-driving requirement).
--   - candidate_type      — agency-side taxonomy ("Clinical Lead",
--                            "Site Engineer", etc.). Free text for now;
--                            promotes to a lookup table later if needed.
--   - skills              — comma-separated tags. Stored as TEXT and split
--                            on the frontend; sub-table is a follow-up if
--                            filter-by-skill becomes a need.

USE `builtrightstudio_cms`;

ALTER TABLE `recruitment_candidates`
  ADD COLUMN `gender`               ENUM('male','female','other','prefer_not_to_say') NULL
                                    AFTER `nationality`,
  ADD COLUMN `has_driving_license`  TINYINT(1) NOT NULL DEFAULT 0
                                    AFTER `country`,
  ADD COLUMN `willing_to_drive`     TINYINT(1) NOT NULL DEFAULT 0
                                    AFTER `has_driving_license`,
  ADD COLUMN `candidate_type`       VARCHAR(120) NULL
                                    AFTER `role`,
  ADD COLUMN `skills`               TEXT NULL
                                    AFTER `experience_years`;

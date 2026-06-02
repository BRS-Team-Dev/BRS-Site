-- Effort mode is decided at the sprint/iteration level (not per-item).
-- Days is the default unit; switching modes only changes which item field
-- the UI surfaces (story_points vs effort_days), not the underlying data.

ALTER TABLE task_iterations
    ADD COLUMN effort_mode ENUM('points','days') NOT NULL DEFAULT 'days'
    AFTER state;

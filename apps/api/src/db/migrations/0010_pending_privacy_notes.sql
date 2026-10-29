-- Pending results have no expiry until the completion timestamp is known,
-- matching the other ephemeral result tables. Completion stamps all rows.
ALTER TABLE ephemeral_ai_notes ALTER COLUMN expires_at DROP NOT NULL;

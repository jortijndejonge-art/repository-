-- Payment-due reminders: remember when each membership was last nudged.
ALTER TABLE memberships ADD COLUMN last_reminder_at timestamptz;

-- Automatic availability chasing: remember when a match last had a reminder, and mark reminders in the chat.
ALTER TABLE fixtures ADD COLUMN last_chased_at timestamptz;
ALTER TABLE event_messages ADD COLUMN system boolean NOT NULL DEFAULT false;

-- Optional password sign-in (alongside email links). Only a salted hash is stored.
ALTER TABLE members ADD COLUMN password_hash text;

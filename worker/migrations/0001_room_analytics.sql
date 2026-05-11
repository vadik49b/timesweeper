CREATE TABLE IF NOT EXISTS room_analytics (
  event_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  slot_count INTEGER NOT NULL,
  participant_count INTEGER NOT NULL,
  participants_with_availability_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

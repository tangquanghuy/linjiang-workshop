PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  token_balance INTEGER NOT NULL DEFAULT 0,
  token_earned_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  return_origin TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workshop_items (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('streamer', 'city_node', 'extension')),
  owner_discord_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  content_version INTEGER NOT NULL DEFAULT 1,
  like_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
  UNIQUE (owner_discord_id, item_type, title)
);

CREATE TABLE IF NOT EXISTS item_likes (
  item_id TEXT NOT NULL,
  user_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, user_discord_id),
  FOREIGN KEY (item_id) REFERENCES workshop_items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS install_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_version INTEGER NOT NULL,
  installer_discord_id TEXT NOT NULL,
  rewarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES workshop_items(id) ON DELETE CASCADE,
  FOREIGN KEY (installer_discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
  UNIQUE (item_id, installer_discord_id)
);

CREATE TABLE IF NOT EXISTS token_ledger (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
  UNIQUE (reason, source_id)
);

CREATE TABLE IF NOT EXISTS token_claims (
  id TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_type_created ON workshop_items(item_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_owner ON workshop_items(owner_discord_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_downloads ON workshop_items(item_type, download_count DESC);
CREATE INDEX IF NOT EXISTS idx_items_likes ON workshop_items(item_type, like_count DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(discord_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_installs_item ON install_events(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON token_ledger(discord_id, created_at DESC);

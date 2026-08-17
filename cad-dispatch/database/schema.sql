CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE,
  username TEXT,
  full_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'dispatcher',
  department TEXT NOT NULL,
  permissions JSONB DEFAULT '[]'::jsonb,
  -- 'pending' until an administrator approves the access request.
  status TEXT NOT NULL DEFAULT 'pending',
  -- scrypt$N$r$p$salt$key. Never stores a plaintext password.
  password_hash TEXT NOT NULL DEFAULT '',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set for emailed self-service resets; NULL means the password does not expire.
  temp_password_expires_at TIMESTAMPTZ,
  -- Incremented on any credential or status change to invalidate issued JWTs.
  password_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  last_login_at TIMESTAMPTZ,
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
  ON users (username) WHERE username IS NOT NULL;

-- Append-only record of administrator actions surfaced in the admin portal.
CREATE TABLE IF NOT EXISTS admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  department TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Available',
  lat DOUBLE PRECISION DEFAULT 0,
  lng DOUBLE PRECISION DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  priority TEXT NOT NULL,
  department TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION DEFAULT 0,
  lng DOUBLE PRECISION DEFAULT 0,
  assigned_unit TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id TEXT REFERENCES calls(id),
  author_id UUID REFERENCES users(id),
  summary TEXT NOT NULL,
  narrative TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warrants (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  offense TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  issued_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bolos (
  id TEXT PRIMARY KEY,
  subject TEXT,
  description TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  issued_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Verified',
  vin TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS civilian_records (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  alias TEXT,
  status TEXT NOT NULL DEFAULT 'Clear',
  risk_level TEXT DEFAULT 'Low',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  resource TEXT NOT NULL,
  actions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- schema.sql

-- Stations Table
CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  lat FLOAT NOT NULL,
  lng FLOAT NOT NULL,
  status TEXT DEFAULT 'available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Units Table (Vehicles)
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g., 'ambulance', 'fire', 'moto'
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  lat FLOAT DEFAULT 0,
  lng FLOAT DEFAULT 0,
  status TEXT DEFAULT 'available', -- 'available', 'en_route', 'on_site'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alerts Table (Incidents)
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  type TEXT NOT NULL, -- 'fire', 'medical', 'accident', etc.
  lat FLOAT NOT NULL,
  lng FLOAT NOT NULL,
  photo_url TEXT,
  notes TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'dispatched', 'resolved'
  station_id TEXT REFERENCES stations(id) ON DELETE SET NULL,
  assigned_unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  viewed_at TIMESTAMP WITH TIME ZONE,
  transit_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  report JSONB -- Intervention details
);

-- Tactical Messaging Table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT, -- 'admin' or station_id or unit_id
  recipient_id TEXT, -- 'all', 'admin', station_id
  content TEXT NOT NULL,
  is_broadcast BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unit Positions Table (High frequency tracking)
CREATE TABLE IF NOT EXISTS positions_unites (
  id BIGSERIAL PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  lat FLOAT NOT NULL,
  lng FLOAT NOT NULL,
  heading FLOAT DEFAULT 0,
  speed FLOAT DEFAULT 0,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries on recent positions
CREATE INDEX IF NOT EXISTS idx_positions_unites_unit_timestamp ON positions_unites(unit_id, timestamp DESC);

-- Secrets Table
CREATE TABLE IF NOT EXISTS auth_secrets (
  id TEXT PRIMARY KEY REFERENCES stations(id),
  password_hash TEXT NOT NULL
);

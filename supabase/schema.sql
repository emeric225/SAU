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

-- Secrets Table (Wait, we can use a simpler approach or just store hash in stations/units)
-- For now, let's just make sure stations are populated with passwords if needed or use a simple env-based secret.
-- If the user wants a real auth table:
CREATE TABLE IF NOT EXISTS auth_secrets (
  id TEXT PRIMARY KEY REFERENCES stations(id),
  password_hash TEXT NOT NULL
);

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const stations = [
  {"name":"GSPM Indénié","city":"Abidjan","lat":5.3365,"lng":-4.0268},
  {"name":"GSPM Yopougon","city":"Abidjan","lat":5.3483,"lng":-4.0822},
  {"name":"GSPM Marcory","city":"Abidjan","lat":5.2897,"lng":-3.9732},
  {"name":"GSPM Cocody","city":"Abidjan","lat":5.3450,"lng":-3.9895},
  {"name":"GSPM Abobo","city":"Abidjan","lat":5.4302,"lng":-4.0154},
  {"name":"Caserne Bouaké","city":"Bouaké","lat":7.6906,"lng":-5.0302},
  {"name":"Caserne Yamoussoukro","city":"Yamoussoukro","lat":6.8276,"lng":-5.2893},
  {"name":"Caserne San Pedro","city":"San Pedro","lat":4.7485,"lng":-6.6363},
  {"name":"Caserne Daloa","city":"Daloa","lat":6.8774,"lng":-6.4502},
  {"name":"Caserne Korhogo","city":"Korhogo","lat":9.4579,"lng":-5.6296},
  {"name":"Caserne Man","city":"Man","lat":7.4125,"lng":-7.5538},
  {"name":"Caserne Gagnoa","city":"Gagnoa","lat":6.1333,"lng":-5.9333},
  {"name":"Caserne Abengourou","city":"Abengourou","lat":6.7297,"lng":-3.4964},
  {"name":"Caserne Bondoukou","city":"Bondoukou","lat":8.0390,"lng":-2.8000},
  {"name":"Caserne Odienné","city":"Odienné","lat":9.5045,"lng":-7.5698}
];

async function seed() {
  try {
    console.log("Initializing database schema...");
    
    // Enable PostGIS if not enabled
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fire_stations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        location GEOGRAPHY(POINT, 4326),
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone TEXT NOT NULL,
        type TEXT NOT NULL,
        location GEOGRAPHY(POINT, 4326),
        photo_url TEXT,
        status TEXT DEFAULT 'pending',
        station_id INTEGER REFERENCES fire_stations(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Seeding fire stations...");
    for (const s of stations) {
      await pool.query(
        'INSERT INTO fire_stations (name, city, location) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326))',
        [s.name, s.city, s.lng, s.lat]
      );
    }

    console.log("Seed completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
}

seed();

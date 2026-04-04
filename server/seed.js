// seed.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seed() {
  console.log("🚀 Seeding stations into Supabase...");
  
  try {
    const stationsPath = path.join(__dirname, 'stations.json');
    const stationsData = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
    
    // Normalize status: 'active' -> 'available'
    const normalized = stationsData.map(s => ({
      id: s.id,
      name: s.name,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
      status: s.status === 'active' ? 'available' : s.status
    }));

    const { data, error } = await supabase
      .from('stations')
      .upsert(normalized, { onConflict: 'id' });

    if (error) throw error;
    
    console.log(`✅ Success! ${normalized.length} stations imported/updated.`);
    
    // Seed default units if needed
    console.log("🚒 Seeding default units...");
    const defaultUnits = [
      { id: "u1", station_id: "sn1", name: "Ambulance Alpha", type: "ambulance" },
      { id: "u2", station_id: "sn1", name: "Fourgon Pompe", type: "fire" },
      { id: "u3", station_id: "sn2", name: "Moto Rapide", type: "moto" }
    ];
    
    const { error: uError } = await supabase.from('units').upsert(defaultUnits, { onConflict: 'id' });
    if (uError) console.warn("Unit seeding failed (might be due to empty station table or foreign key constraint):", uError.message);
    else console.log("✅ Units seeded.");

  } catch (err) {
    console.error("❌ Seed error:", err.message);
  }
}

seed();

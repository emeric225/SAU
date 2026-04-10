const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'server/.env' });
const supabaseUrl = process.env.SUPABASE_URL || "https://ryjofovsvknycdpmswnn.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAlerts() {
    const { data: alerts, error } = await supabase.from('alerts').select('id, lat, lng').order('created_at', { ascending: false }).limit(5);
    console.log("ALERTS:", JSON.stringify(alerts, null, 2));
}
checkAlerts();

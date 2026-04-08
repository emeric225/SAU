require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function purgeAlerts() {
  console.log('--- PURGE DES ALERTES GHOST ---');
  const { data, error } = await supabase
    .from('alerts')
    .update({ status: 'resolved' })
    .neq('status', 'resolved');

  if (error) console.error('Error purging alerts:', error);
  else console.log('Toutes les alertes actives ont été résolues.');

  // Also clean units
  await supabase.from('units').update({ status: 'available' }).neq('status', 'available');
  console.log('Toutes les unités ont été remises en "available".');
}

purgeAlerts();

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function deleteAllAlerts() {
  console.log('Suppression de TOUTES les alertes...');
  const { data, error } = await supabase
    .from('alerts')
    .delete()
    .neq('status', 'resolved');
  
  const { data: d2, error: e2 } = await supabase
    .from('alerts')
    .delete()
    .eq('status', 'resolved');

  if (error || e2) console.error('Erreur:', error || e2);
  else console.log('Toutes les alertes ont ete supprimees.');

  await supabase.from('units').update({ status: 'available', current_alert_id: null }).neq('status', 'available');
  console.log('Unites reinitialisees.');
}

deleteAllAlerts();

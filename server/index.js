require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // For self-pinger

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH'],
  }
});

// SUPABASE CONFIG
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  console.warn('[SAU] ⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. switching to MOCK MODE.');
  // Mock Supabase client for local development
  const mockStations = JSON.parse(fs.readFileSync(path.join(__dirname, 'stations.json'), 'utf8'));
  const mockUnits = mockStations.map(s => ({ ...s, id: 'u' + s.id.replace('sn', ''), station_id: s.id, status: 'available' }));
  const mockAlerts = [];
  const mockMessages = [];

  const createMockQuery = (data, table) => {
    return {
      from: (t) => createMockQuery(data, t),
      select: () => createMockQuery(data, table),
      insert: (items) => {
        const newItems = items.map(item => ({ ...item, created_at: new Date() }));
        if (table === 'alerts') mockAlerts.push(...newItems);
        if (table === 'messages') mockMessages.push(...newItems);
        if (table === 'units') mockUnits.push(...newItems);
        return createMockQuery(newItems, table);
      },
      update: (updates) => {
        return {
          eq: (key, value) => {
            let targetData = [];
            if (table === 'units') targetData = mockUnits;
            if (table === 'alerts') targetData = mockAlerts;
            if (table === 'stations') targetData = mockStations;
            
            const items = targetData.filter(item => item[key] === value);
            items.forEach(item => Object.assign(item, updates));
            return createMockQuery(items, table);
          }
        };
      },
      delete: () => ({ eq: (k, v) => {
        if (table === 'units') {
          const idx = mockUnits.findIndex(u => u[k] === v);
          if (idx !== -1) mockUnits.splice(idx, 1);
        }
        return { error: null };
      }}),
      eq: (key, value) => {
        let source = [];
        if (table === 'stations') source = mockStations;
        if (table === 'units') source = mockUnits;
        if (table === 'alerts') source = mockAlerts;
        const result = source.find(item => item[key] === value);
        return createMockQuery(result, table);
      },
      not: () => createMockQuery(data, table),
      or: () => createMockQuery(data, table),
      neq: () => createMockQuery(data, table),
      order: () => createMockQuery(data, table),
      limit: () => createMockQuery(data, table),
      single: () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
      maybeSingle: () => ({ data: Array.isArray(data) ? data[0] : data, error: null }),
      then: (fn) => Promise.resolve(fn({ data, error: null }))
    };
  };

  supabase = {
    from: (table) => {
      let data = [];
      if (table === 'stations') data = mockStations;
      if (table === 'units') data = mockUnits;
      if (table === 'alerts') data = mockAlerts;
      if (table === 'messages') data = mockMessages;
      return createMockQuery(data, table);
    }
  };
}

// KEEP-ALIVE (RENDER)
app.get('/api/ping', (req, res) => res.status(200).send('pong'));

// Simulation interval tracker to prevent conflicts with real GPS
// Track units sending real GPS to disable simulations
const gpsActiveUnits = new Set();
const simulationIntervals = new Map();
const lastDbUpdate = new Map(); // Performance: Throttling DB writes
const SELF_URL = process.env.SELF_URL || `http://localhost:${process.env.PORT || 3008}`;

setInterval(async () => {
  try {
    await axios.get(`${SELF_URL}/api/ping`);
    console.log('[SAU] 💓 Self-ping successful to keep Render awake.');
  } catch (err) {
    console.error('[SAU] 💔 Self-ping failed', err.message);
  }
}, 14 * 60 * 1000);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logic for Supabase migration: removed in-memory arrays.
// Stations are now fetched from Supabase directly.

// app.use((req, res, next) => { req.mockMode = mockMode; next(); });

// POST /api/alerts (with smarter dispatch)
app.post('/api/alerts', async (req, res) => {
  const { name, phone, type, lat, lng, photo_url, notes } = req.body;
  
  try {
    // Dispatch intelligent (proximité + disponibilité)
    const { data: stations, error: stError } = await supabase
      .from('stations')
      .select('*')
      .not('status', 'in', '("busy","offline")');

    if (stError) throw stError;

    let nearest = null; 
    let minDocs = Infinity;
    stations.forEach(s => {
      const d = Math.sqrt(Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2));
      if (d < minDocs) { minDocs = d; nearest = s; }
    });

    const alertId = Date.now().toString();
    const { data: alert, error } = await supabase
      .from('alerts')
      .insert([{
        id: alertId, name, phone, type, lat, lng, 
        photo_url, notes: notes || '', status: 'pending',
        station_id: nearest ? nearest.id : null
      }])
      .select()
      .single();

    if (error) throw error;

    const targetRoom = alert.station_id ? `station_${alert.station_id}` : null;
    let broadcaster = io.to('admin');
    if (targetRoom) broadcaster = broadcaster.to(targetRoom);
    broadcaster.emit('new_alert', alert);
    res.status(201).json(alert);
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: 'Fail' }); 
  }
});

// POINT 3: CRUD COMPLET des casernes
app.post('/api/stations', async (req, res) => {
  const { name, city, lat, lng } = req.body;
  const { data, error } = await supabase
    .from('stations')
    .insert([{ id: `sn${Date.now()}`, name, city, lat: parseFloat(lat), lng: parseFloat(lng), status: 'available' }])
    .select()
    .single();
  
  if (error) return res.status(500).json(error);
  const { data: stations } = await supabase.from('stations').select('*');
  io.emit('stations_list_updated', stations);
  res.status(201).json(data);
});

app.put('/api/stations/:id', async (req, res) => {
  const { id } = req.params;
  const { name, city, lat, lng } = req.body;
  const { data, error } = await supabase
    .from('stations')
    .update({ name, city, lat: parseFloat(lat), lng: parseFloat(lng) })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(404).json({ error: 'Station not found' });
  const { data: stations } = await supabase.from('stations').select('*');
  io.emit('stations_list_updated', stations);
  io.emit('station_updated', data);
  res.json(data);
});

app.delete('/api/stations/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('stations').delete().eq('id', id);
  if (error) return res.status(500).json(error);
  const { data: stations } = await supabase.from('stations').select('*');
  io.emit('stations_list_updated', stations);
  res.json({ success: true });
});


// GET routes
app.get('/api/stations', async (req, res) => {
  const { data } = await supabase.from('stations').select('*');
  res.json(data || []);
});
app.get('/api/alerts', async (req, res) => {
  const { data } = await supabase.from('alerts').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});
app.get('/api/units', async (req, res) => {
  const { data } = await supabase.from('units').select('*');
  res.json(data || []);
});

// CRUD Units
app.post('/api/units', async (req, res) => {
  const { id, name, type, station_id } = req.body;
  const unitId = id || `u${Math.floor(Math.random()*1000)}`;
  
  // Get station pos for initial unit pos
  const { data: station } = await supabase.from('stations').select('lat, lng').eq('id', station_id).single();
  
  const { data: unit, error } = await supabase
    .from('units')
    .insert([{ 
      id: unitId, name, type, station_id, 
      lat: station?.lat || 0, lng: station?.lng || 0, 
      status: 'available' 
    }])
    .select()
    .single();

  if (error) return res.status(500).json(error);
  io.emit('unit_updated', unit);
  res.status(201).json(unit);
});

app.delete('/api/units/:id', async (req, res) => {
  const { id } = req.params;
  await supabase.from('units').delete().eq('id', id);
  io.emit('unit_deleted', id);
  res.json({ success: true });
});
app.get('/api/kpis', async (req, res) => {
  const { data: alerts } = await supabase.from('alerts').select('status');
  const activeRescues = alerts?.filter(a => a.status !== 'resolved').length || 0;
  res.json({ activeRescues, totalToday: 12, avgResponseTime: "8 min" });
});

app.get('/api/messages', async (req, res) => {
  const { userId } = req.query;
  let query = supabase.from('messages').select('*').order('timestamp', { ascending: true });
  
  if (userId !== 'admin') {
    query = query.or(`recipient_id.eq.all,recipient_id.eq.${userId},sender_id.eq.${userId}`);
  }
  
  const { data } = await query;
  res.json(data || []);
});

// PATCH /api/alerts/:id
app.patch('/api/alerts/:id', async (req, res) => {
  const { id } = req.params;
  const { status, station_id, notes, report, assigned_unit_id } = req.body;
  try {
    // 1. Important: Get current alert state to know which unit was assigned before updating
    const { data: existingAlert } = await supabase
      .from('alerts')
      .select('assigned_unit_id')
      .eq('id', id)
      .maybeSingle();

    const updateData = {};
    if (status) updateData.status = status;
    if (station_id !== undefined) updateData.station_id = station_id;
    if (assigned_unit_id !== undefined) updateData.assigned_unit_id = assigned_unit_id;
    if (notes !== undefined) updateData.notes = notes;
    if (report) updateData.report = report; // Pass the object directly for JSONB columns!
    if (status === 'resolved') updateData.resolved_at = new Date().toISOString();

    let { data: alerts, error } = await supabase
      .from('alerts')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
       console.error('[SAU] Report update error:', error);
       return res.status(500).json({ error: error.message || "Erreur base de données" });
    }
    
    const alert = alerts && alerts.length > 0 ? alerts[0] : null;
    if (!alert) {
      return res.status(404).json({ error: "Alerte introuvable ou déjà clôturée (ID invalide)." });
    }

    // --- MISSION CANCELLATION LOGIC ---
    if (status === 'pending') {
      // Use the ID from BEFORE the update to find who to notify
      const unitToReset = existingAlert?.assigned_unit_id;
      if (unitToReset) {
        const { data: unit } = await supabase
          .from('units')
          .update({ status: 'available' })
          .eq('id', unitToReset)
          .select()
          .maybeSingle();
        
        if (unit) io.emit('unit_updated', unit);
      }
    }

    io.emit('alert_updated', alert);
    res.json(alert);
  } catch (err) { 
    console.error('[SAU] Report update final error:', err);
    res.status(500).json({ error: err.message || JSON.stringify(err) }); 
  }
});

// Station Status
app.post('/api/stations/status/:id', async (req, res) => {
  const { id } = req.params; const { status } = req.body;
  const { data: station, error } = await supabase
    .from('stations')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(404).json({ error: 'Not found' });
  io.emit('station_updated', station);
  res.json({ success: true, station });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { stationId, password } = req.body || {};
    
    if (!stationId) {
       return res.status(400).json({ error: 'ID non fourni' });
    }

    // 1. Try to find if the ID belongs to a Unit
    const { data: unit, error: unitErr } = await supabase.from('units').select('*').eq('id', stationId).maybeSingle();
    
    if (unit) {
      const { data: activeAlert } = await supabase
        .from('alerts')
        .select('*')
        .or(`assigned_unit_id.eq.${unit.id},and(station_id.eq.${unit.station_id},status.in.(dispatched,on_site))`)
        .neq('status', 'resolved')
        .order('created_at', { ascending: false })
        .limit(1);
        
      let activeAlertData = activeAlert && activeAlert.length > 0 ? activeAlert[0] : null;
      
      // Auto-fix: if the unit thinks it is deployed but there is no active mission
      if (!activeAlertData && unit.status !== 'available') {
          const { data: updatedUnit } = await supabase.from('units').update({ status: 'available' }).eq('id', unit.id).select().maybeSingle();
          if (updatedUnit) unit.status = updatedUnit.status;
      }

      return res.json({ success: true, station: unit, isUnit: true, currentMission: activeAlertData || null });
    }
    
    if (stationId === 'admin') {
      if (password !== 'sau_admin2026') return res.status(401).json({ error: 'Mot de passe QG incorrect' });
      return res.json({ success: true, station: { id: 'admin', name: 'QG Central' } });
    }

    const { data: station, error: stErr } = await supabase.from('stations').select('*').eq('id', stationId).maybeSingle();
    if (station) {
      if (password !== 'pompiers119') return res.status(401).json({ error: 'Mot de passe caserne incorrect' });
      return res.json({ success: true, station: station });
    }
    
    res.status(401).json({ error: 'Identifiant invalide ou inexistant' });
  } catch (error) {
    console.error('[SAU LOGIN ERROR]', error);
    res.status(500).json({ error: 'Erreur interne du serveur lors de la connexion' });
  }
});

// Sockets
io.on('connection', (socket) => {
  console.log(`[SAU] 📡 Nouvelle liaison établie : ${socket.id}`);
  
  socket.on('join_room', (userId) => {
    if (userId === 'admin') { socket.join('admin'); }
    else { socket.join(`station_${userId}`); }
  });

  socket.on('alert_viewed', async (id) => {
    const { data: alert } = await supabase.from('alerts').select('*').eq('id', id).single();
    if (alert && !alert.viewed_at) {
      const { data: updated } = await supabase.from('alerts').update({ viewed_at: new Date() }).eq('id', id).select().single();
      io.to('admin').emit('alert_updated', updated);
      console.log(`[SAU] 👀 Alerte ${id} vue par l'unité tactique.`);
    }
  });

  socket.on('unit_transit', async (data) => {
    // data: { alertId, stationId, stationName }
    console.log(`[SAU] 🚒 Unité ${data.stationName} en transit vers alerte ${data.alertId}`);
    await supabase.from('alerts').update({ transit_at: new Date(), station_id: data.stationId }).eq('id', data.alertId);
    io.to('admin').emit('unit_transit', data);
  });

  socket.on('unit_moved', async (data) => {
    // data: { id, lat, lng, heading, speed }
    const unitId = data.id || data.unitId;
    if (!unitId) return;
    
    // 1. INSTANT BROADCAST (Pour le Dashboard - Pas de coût DB)
    io.emit('unit_moved', { ...data, id: unitId });

    // 2. THROTTLED PERSISTENCE (Supabase - Toutes les 30s)
    const now = Date.now();
    const lastUpdate = lastDbUpdate.get(unitId) || 0;
    
    if (now - lastUpdate > 30000) {
      lastDbUpdate.set(unitId, now);
      try {
        await supabase
          .from('units')
          .update({ lat: data.lat, lng: data.lng })
          .eq('id', unitId);
      } catch (err) {
        console.error('[SAU] Erreur de synchronisation DB:', err.message);
      }
    }

    // Gestion de la logique GPS
    gpsActiveUnits.add(unitId);
    if (simulationIntervals.has(unitId)) {
      clearInterval(simulationIntervals.get(unitId));
      simulationIntervals.delete(unitId);
    }
  });

  socket.on('assign_unit', async (data) => {
    // data: { unitId, alertId }
    // Une assignation ne change pas l'état de l'unité, elle le fera elle-même en acceptant (DÉMARRER)
    const { data: unit } = await supabase.from('units').select().eq('id', data.unitId).single();
    const { data: alert } = await supabase.from('alerts').update({ status: 'dispatched', assigned_unit_id: data.unitId }).eq('id', data.alertId).select().single();
    
    if (unit && alert) {
      io.emit('alert_updated', alert);
      // Notify the specific unit
      io.to(`station_${unit.id}`).emit('mission_received', alert);
      console.log(`[SAU] 📡 Mission ${alert.id} assignée à l'unité ${unit.id}`);

      // Mode Démonstration retiré: La navigation est uniquement déclenchée par l'API GPS de l'unité
    }
  });

  socket.on('unit_status_update', async (data) => {
    // data: { unitId, status, alertId, transit_at, on_site_at }
    const updateData = { status: data.status };
    if (data.status === 'available') updateData.current_alert_id = null;
    
    const { data: unit } = await supabase.from('units').update(updateData).eq('id', data.unitId).select().single();
    
    if (unit) {
      if (data.alertId) {
        const alertUpdate = {};
        if (data.status === 'en_route') {
            alertUpdate.status = 'dispatched';
            alertUpdate.transit_at = data.transit_at || new Date().toISOString();
        } else if (data.status === 'on_site') {
            alertUpdate.status = 'on_site';
            alertUpdate.on_site_at = data.on_site_at || new Date().toISOString();
        }
        
        if (Object.keys(alertUpdate).length > 0) {
            const { data: ale } = await supabase.from('alerts').update(alertUpdate).eq('id', data.alertId).select().single();
            if (ale) io.emit('alert_updated', ale);
        }
      }
      io.emit('unit_updated', unit);
    }
  });

  socket.on('disconnect', () => { console.log(`[SAU] 🔌 Liaison perdue : ${socket.id}`); });

  socket.on('send_message', async (msg) => {
    const { data: m } = await supabase
      .from('messages')
      .insert([{ 
        id: Date.now().toString(), 
        sender_id: msg.sender_id,
        recipient_id: msg.recipient_id,
        content: msg.content,
        is_broadcast: msg.isBroadcast || false
      }])
      .select()
      .single();
    
    if (m) {
      if (m.recipient_id === 'all' || m.is_broadcast) {
        io.emit('receive_message', m);
      } else if (m.recipient_id === 'admin') {
        io.to('admin').emit('receive_message', m);
        socket.emit('receive_message', m);
      } else {
        io.to(`station_${m.recipient_id}`).emit('receive_message', m);
        socket.emit('receive_message', m);
      }
    }
  });

  // POINT 12: Mode Crise
  socket.on('toggle_crisis', (active) => {
    console.log(`[SAU] 🚨 MODE CRISE ${active ? 'ACTIVER' : 'DÉSACTIVER'}`);
    io.emit('crisis_update', { active });
  });
});


const PORT = process.env.PORT || 3008;
server.listen(PORT, '0.0.0.0', () => console.log(`[SAU] Server running on 0.0.0.0:${PORT}`));

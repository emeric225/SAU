require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH'],
  }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

const mockMode = !process.env.DATABASE_URL || process.env.DATABASE_URL === 'undefined';
let stations = [];
let alerts = [
  {
    id: "mock1", type: "fire", name: "Incendie Test", phone: "0102030405",
    location: { lat: 5.3365, lng: -4.0268 }, status: "pending", notes: "Test",
    station_id: "sn1", created_at: new Date(), viewed_at: null
  }
];
const messages = [];

if (mockMode) {
  try {
    const stationsPath = path.join(__dirname, 'stations.json');
    stations = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
    console.log(`[SAU] Mode MOCK activé. ${stations.length} stations chargées.`);
  } catch (err) { console.error("Error loading stations", err); }
}

app.use((req, res, next) => { req.mockMode = mockMode; next(); });

// POST /api/alerts
app.post('/api/alerts', async (req, res) => {
  const { name, phone, type, lat, lng, photo_url } = req.body;
  const alert = {
    id: Date.now().toString(), name, phone, type, location: { lat, lng },
    photo_url, notes: '', status: 'pending', created_at: new Date(), viewed_at: null
  };
  try {
    if (req.mockMode) {
      let nearest = null; let minDocs = Infinity;
      stations.forEach(s => {
        const d = Math.sqrt(Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2));
        if (d < minDocs) { minDocs = d; nearest = s; }
      });
      alert.station_id = nearest ? nearest.id : null;
      alerts.push(alert);
    }
    const targetRoom = alert.station_id ? `station_${alert.station_id}` : null;
    let broadcaster = io.to('admin');
    if (targetRoom) broadcaster = broadcaster.to(targetRoom);
    broadcaster.emit('new_alert', alert);
    res.status(201).json(alert);
  } catch (err) { res.status(500).json({ error: 'Fail' }); }
});

// GET routes
app.get('/api/stations', (req, res) => res.json(stations));
app.get('/api/alerts', (req, res) => res.json(alerts));
app.get('/api/kpis', (req, res) => res.json({ activeRescues: alerts.filter(a => a.status !== 'resolved').length, totalToday: 12, avgResponseTime: "8 min" }));
app.get('/api/messages', (req, res) => {
  const { userId } = req.query;
  if (userId === 'admin') return res.json(messages);
  const filtered = messages.filter(m => 
    m.recipient_id === 'all' || 
    m.recipient_id === userId || 
    m.sender_id === userId
  );
  res.json(filtered);
});

// PATCH /api/alerts/:id
app.patch('/api/alerts/:id', async (req, res) => {
  const { id } = req.params;
  const { status, station_id, notes, report } = req.body;
  try {
    const alert = alerts.find(a => a.id === id);
    if (alert) {
      if (status) alert.status = status;
      if (station_id) alert.station_id = station_id;
      if (notes !== undefined) alert.notes = notes;
      if (report) alert.report = report;
    }
    const targetRoom = alert.station_id ? `station_${alert.station_id}` : null;
    let broadcaster = io.to('admin');
    if (targetRoom) broadcaster = broadcaster.to(targetRoom);
    broadcaster.emit('alert_updated', alert);
    res.json(alert);
  } catch (err) { res.status(500).json({ error: 'Fail' }); }
});

// Station Status
app.post('/api/stations/status/:id', (req, res) => {
  const { id } = req.params; const { status } = req.body;
  const station = stations.find(s => s.id === id);
  if (station) {
    station.status = status;
    io.emit('station_updated', station);
    res.json({ success: true, station });
  } else res.status(404).json({ error: 'Not found' });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { stationId } = req.body;
  const station = stations.find(s => s.id === stationId);
  if (station || stationId === 'admin') {
    res.json({ success: true, station: station || { id: 'admin', name: 'QG Central' } });
  } else res.status(401).json({ error: 'Fail' });
});

// Sockets
io.on('connection', (socket) => {
  console.log(`[SAU] 📡 Nouvelle liaison établie : ${socket.id}`);
  
  socket.on('join_room', (userId) => {
    if (userId === 'admin') { socket.join('admin'); }
    else { socket.join(`station_${userId}`); }
  });

  socket.on('alert_viewed', (id) => {
    const alert = alerts.find(a => a.id === id);
    if (alert && !alert.viewed_at) {
      alert.viewed_at = new Date();
      io.to('admin').emit('alert_updated', alert);
      console.log(`[SAU] 👀 Alerte ${id} vue par l'unité tactique.`);
    }
  });

  socket.on('unit_transit', (data) => {
    // data: { alertId, stationId, stationName }
    console.log(`[SAU] 🚒 Unité ${data.stationName} en transit vers alerte ${data.alertId}`);
    // Update alert status to 'en_route' if needed (already 'dispatched', just flag it)
    const alert = alerts.find(a => a.id === data.alertId);
    if (alert) {
      alert.transit_at = new Date();
      alert.transit_station = data.stationId;
    }
    // Notify HQ
    io.to('admin').emit('unit_transit', data);
  });

  socket.on('disconnect', () => { console.log(`[SAU] 🔌 Liaison perdue : ${socket.id}`); });

  socket.on('send_message', (msg) => {
    const m = { ...msg, id: Date.now().toString(), timestamp: new Date() };
    messages.push(m);
    
    if (m.recipient_id === 'all') {
      io.emit('receive_message', m);
    } else if (m.recipient_id === 'admin') {
      io.to('admin').emit('receive_message', m);
      // If the sender is a station, they also need to see their own message in their local state
      socket.emit('receive_message', m);
    } else {
      // Direct message to a specific station
      io.to(`station_${m.recipient_id}`).emit('receive_message', m);
      // Sender also gets it (Admin usually)
      socket.emit('receive_message', m);
    }
  });
});

const PORT = process.env.PORT || 3008;
server.listen(PORT, '0.0.0.0', () => console.log(`[SAU] Server running on 0.0.0.0:${PORT}`));

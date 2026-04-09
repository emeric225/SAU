'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import NextDynamic from 'next/dynamic';
import { io } from 'socket.io-client';
import styles from './dashboard.module.css';

import type { DashboardMapProps } from '@/components/DashboardMap';

// ─── Chargement dynamique de la carte MapLibre (SSR désactivé pour le DOM) ─────
const DashboardMap = NextDynamic<DashboardMapProps>(
  () => import('@/components/DashboardMap'),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: '100%', height: '100%', background: '#05070a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', fontWeight: 800 }}>
        INITIALISATION CARTE TACTIQUE...
      </div>
    ),
  }
);

const VIEWS = ['map', 'dispatch', 'stations', 'analytics'] as const;
type View = typeof VIEWS[number];

export default function Dashboard() {
  const socketRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<any>(null);

  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [stations, setStations] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // UI state
  const [currentView, setCurrentView] = useState<View>('map');
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [newAlertPopup, setNewAlertPopup] = useState<any>(null);
  const [reportingAlert, setReportingAlert] = useState<any>(null);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [isCrisisMode, setIsCrisisMode] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [chatRecipient, setChatRecipient] = useState('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAddingStation, setIsAddingStation] = useState(false);
  const [editingStation, setEditingStation] = useState<any>(null);
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [newUnitType, setNewUnitType] = useState('fire');
  const [kpis, setKpis] = useState({ activeRescues: 0, totalToday: 0, avgResponseTime: '—' });

  // ─── Audio (usando ref para evitar stale closure) ─────────────────────────────
  const playSiren = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      let count = 0;
      const interval = setInterval(() => {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(count % 2 === 0 ? 800 : 1000, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
        count++;
        if (count >= 20) clearInterval(interval);
      }, 500);
    } catch (e) { console.error('[Audio]', e); }
  }, []); // Pas de dépendances : utilise ref directement

  const enableAudio = () => {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioCtx();
    audioCtxRef.current?.resume();
    setAudioEnabled(true);
  };

  // ─── Fetch Data ───────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (userIdOverride?: string) => {
    try {
      let currentId = userIdOverride || userRef.current?.id;
      if (!currentId) {
        try { currentId = JSON.parse(localStorage.getItem('sau_station') || '{}').id; } catch { /* ignore */ }
      }
      const [sData, aData, kData, mData, uData] = await Promise.all([
        fetch('/api/stations').then(r => r.json()),
        fetch('/api/alerts').then(r => r.json()),
        fetch('/api/kpis').then(r => r.json()),
        fetch(`/api/messages?userId=${currentId}`).then(r => r.json()),
        fetch('/api/units').then(r => r.json()),
      ]);
      setStations(Array.isArray(sData) ? sData : []);
      setAlerts(Array.isArray(aData) ? [...aData].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : []);
      setKpis(kData || { activeRescues: 0, totalToday: 0, avgResponseTime: '—' });
      setMessages(Array.isArray(mData) ? mData.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) : []);
      setUnits(Array.isArray(uData) ? uData : []);
      setLoading(false);
    } catch (err) {
      console.error('[Dashboard] fetchData error:', err);
      setLoading(false);
    }
  }, []);

  // ─── Initialisation & Socket ──────────────────────────────────────────────────
  useEffect(() => {
    const session = localStorage.getItem('sau_station');
    if (!session || session === 'undefined') { window.location.href = '/login'; return; }
    let userData: any;
    try { userData = JSON.parse(session); } catch { window.location.href = '/login'; return; }
    setUser(userData);
    userRef.current = userData;
    setMounted(true);
    setChatRecipient(userData.id === 'admin' ? 'all' : 'admin');
    fetchData(userData.id);

    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    const socket = io(serverUrl, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 2000 });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join_room', userData.id);
    });
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('new_alert', (newAlert: any) => {
      setAlerts(prev => [newAlert, ...prev.filter(a => a.id !== newAlert.id)].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      if (userData.id === 'admin' || newAlert.station_id === userData.id) {
        setNewAlertPopup(newAlert);
        playSiren();
      }
    });

    socket.on('alert_updated', (updated: any) => {
      setAlerts(prev => {
        const exists = prev.some(a => a.id === updated.id);
        const next = exists ? prev.map(a => a.id === updated.id ? { ...a, ...updated } : a) : [updated, ...prev];
        return next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      setSelectedAlert((prev: any) => prev?.id === updated.id ? { ...prev, ...updated } : prev);
    });

    socket.on('station_updated', (s: any) => setStations(prev => prev.map(st => st.id === s.id ? { ...st, ...s } : st)));
    socket.on('stations_list_updated', (data: any) => {
      if (Array.isArray(data)) { setStations(data); }
      else { setStations(prev => { const ex = prev.some(s => s.id === data.id); return ex ? prev.map(s => s.id === data.id ? { ...s, ...data } : s) : [...prev, data]; }); }
    });

    socket.on('receive_message', (msg: any) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });
      setIsChatExpanded(expanded => { if (!expanded) setUnreadCount(c => c + 1); return expanded; });
    });

    socket.on('unit_moved', (u: any) => setUnits(prev => prev.map(un => un.id === u.id ? { ...un, lat: u.lat, lng: u.lng } : un)));
    socket.on('unit_updated', (u: any) => setUnits(prev => prev.map(un => un.id === u.id ? { ...un, ...u } : un)));
    socket.on('unit_deleted', (id: string) => setUnits(prev => prev.filter(u => u.id !== id)));
    socket.on('crisis_update', (data: any) => { setIsCrisisMode(data.active); if (data.active) playSiren(); });

    if (Notification.permission !== 'denied') Notification.requestPermission();

    const refreshInterval = setInterval(() => fetchData(), 20000);
    return () => {
      clearInterval(refreshInterval);
      socket.disconnect();
    };
  }, [fetchData, playSiren]);

  // ─── Auto-scroll chat ─────────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ─── Actions Alertes ──────────────────────────────────────────────────────────
  const updateAlertStatus = async (id: string, status: string, report?: any) => {
    if (status === 'resolved' && !report) { setReportingAlert(alerts.find(a => a.id === id)); return; }
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, report }) });
      if (res.ok) { setReportingAlert(null); fetchData(); }
    } catch (err) { console.error('[Alert]', err); }
  };

  const updateAlertStation = async (alertId: string, stationId: string) => {
    try {
      await fetch(`/api/alerts/${alertId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: stationId }) });
      fetchData();
    } catch (err) { console.error('[Assign]', err); }
  };

  // ─── Actions Casernes ─────────────────────────────────────────────────────────
  const createOrUpdateStation = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = { name: (form as any).name.value, city: (form as any).city.value, lat: (form as any).lat.value, lng: (form as any).lng.value };
    try {
      const url = editingStation ? `/api/stations/${editingStation.id}` : '/api/stations';
      const res = await fetch(url, { method: editingStation ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) { setIsAddingStation(false); setEditingStation(null); fetchData(); }
    } catch (err) { console.error('[Station]', err); }
  };

  const deleteStation = async (id: string) => {
    if (!confirm('Supprimer cette caserne ?')) return;
    try {
      const linkedUnits = units.filter(u => u.station_id === id);
      await Promise.all(linkedUnits.map(u => fetch(`/api/units/${u.id}`, { method: 'DELETE' })));
      await fetch(`/api/stations/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) { console.error('[DelStation]', err); }
  };

  // ─── Actions Unités ───────────────────────────────────────────────────────────
  const addUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const id = (form as any).unitId.value;
    const name = (form as any).unitName.value;
    if (!id || !name) return;
    try {
      await fetch('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, type: newUnitType, station_id: user?.id }) });
      setIsAddingUnit(false);
      fetchData();
    } catch (err) { console.error('[AddUnit]', err); }
  };

  const deleteUnit = async (id: string) => {
    if (!confirm('Supprimer cette unité ?')) return;
    try { await fetch(`/api/units/${id}`, { method: 'DELETE' }); fetchData(); } catch (err) { console.error('[DelUnit]', err); }
  };

  // ─── Chat ─────────────────────────────────────────────────────────────────────
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;
    socketRef.current.emit('send_message', { sender_id: user?.id, sender_name: user?.name, recipient_id: chatRecipient, text: chatInput });
    setChatInput('');
  };

  const handleLogout = () => { localStorage.removeItem('sau_station'); window.location.href = '/login'; };
  const toggleCrisisMode = () => { const n = !isCrisisMode; setIsCrisisMode(n); socketRef.current?.emit('toggle_crisis', n); };

  // ─── Filtres ──────────────────────────────────────────────────────────────────
  const filteredAlerts = alerts.filter(a => {
    if (searchTerm && !a.name?.toLowerCase().includes(searchTerm.toLowerCase()) && !a.phone?.includes(searchTerm)) return false;
    if (user?.id !== 'admin' && a.station_id !== user?.id) return false;
    if (user?.id !== 'admin') {
      if (currentView === 'history') return a.status === 'resolved';
    }
    if (filter === 'all') return true;
    return a.status === filter;
  });

  const visibleAlerts = user?.id === 'admin' ? alerts : alerts.filter(a => a.station_id === user?.id);
  const visibleUnits = user?.id === 'admin' ? units : units.filter(u => u.station_id === user?.id);

  // ─── Loading ──────────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div style={{ background: '#05070a', width: '100vw', height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', fontFamily: 'system-ui', fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>
        LIAISON SÉCURISÉE...
      </div>
    );
  }

  return (
    <main className={styles.mapContainer}>
      {isCrisisMode && <div className={styles.crisisOverlay} />}

      {/* ── Carte MapLibre ──────────────────────────────────────────────────── */}
      <DashboardMap
        stations={stations}
        alerts={visibleAlerts}
        units={visibleUnits}
        selectedAlert={selectedAlert}
        onAlertClick={(alert) => { setSelectedAlert(alert); if (user?.id === 'admin') setCurrentView('map'); }}
      />

      {/* ── Navigation latérale Admin ────────────────────────────────────────── */}
      {user?.id === 'admin' && (
        <nav className={styles.hqSideNav}>
          <div className={styles.logoMini}>SAU</div>
          {([
            { view: 'map', icon: '🗺️', title: 'Supervision Carte' },
            { view: 'dispatch', icon: '🚨', title: 'Gestion Alertes' },
            { view: 'stations', icon: '🚒', title: 'Casernes' },
            { view: 'analytics', icon: '📊', title: 'Statistiques' },
          ] as { view: View; icon: string; title: string }[]).map(({ view, icon, title }) => (
            <div key={view} className={`${styles.navIcon} ${currentView === view ? styles.activeNav : ''}`} title={title} onClick={() => setCurrentView(view)}>
              {icon}
            </div>
          ))}
          <div style={{ marginTop: 'auto' }}>
            <div
              className={`${styles.navIcon} ${isCrisisMode ? styles.activeNav : ''}`}
              style={{ background: isCrisisMode ? '#e11d48' : '' }}
              title="MODE CRISE"
              onClick={toggleCrisisMode}
            >🔥</div>
          </div>
        </nav>
      )}

      {/* ── Panneau latéral principal ─────────────────────────────────────────── */}
      <aside className={styles.mainPanel}>
        <header className={styles.panelHeader}>
          <div className={styles.stationBrand}>
            <div className={styles.stationInfo}>
              <div className={styles.stationTitleRow}>
                <span className={styles.stationName}>{user?.name}{isCrisisMode && ' — MODE CRISE 🔥'}</span>
                <div className={`${styles.systemStatus} ${isConnected ? styles.online : styles.offline}`}>
                  {isConnected ? '● ONLINE' : '○ OFFLINE'}
                </div>
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className={styles.btnLogoutIcon} title="Déconnexion">🚪</button>
        </header>

        <div className={styles.panelScroll}>
          {user?.id === 'admin' ? (
            /* ── Vue ADMIN ─────────────────────────────────────────────────── */
            <>
              {currentView === 'map' && (
                <>
                  {/* KPIs */}
                  <div style={{ display: 'flex', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Alertes Actives', value: alerts.filter(a => a.status !== 'resolved').length, color: '#e11d48' },
                      { label: 'Casernes', value: stations.length, color: '#3b82f6' },
                      { label: 'Unités', value: units.length, color: '#10b981' },
                    ].map(k => (
                      <div key={k.label} style={{ flex: 1, background: `${k.color}15`, border: `1px solid ${k.color}40`, borderRadius: 12, padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: k.color }}>{k.value}</div>
                        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{k.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.filterTabs}>
                    <button className={filter === 'all' ? styles.activeTab : ''} onClick={() => setFilter('all')}>Tout</button>
                    <button className={filter === 'pending' ? styles.activeTab : ''} onClick={() => setFilter('pending')}>Urgences</button>
                    <button className={filter === 'dispatched' ? styles.activeTab : ''} onClick={() => setFilter('dispatched')}>Engagés</button>
                  </div>
                  {alerts.filter(a => filter === 'all' ? true : a.status === filter).map(a => (
                    <div
                      key={a.id}
                      className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''} ${selectedAlert?.id === a.id ? styles.tacticalSelected : ''}`}
                      onClick={() => setSelectedAlert(a)}
                    >
                      <div className={styles.cardHeader}>
                        <span className={`${styles.typeBadge} ${styles[a.type] || ''}`}>{a.type?.toUpperCase()}</span>
                        <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString('fr-FR')}</span>
                      </div>
                      <div className={styles.cardBody}>
                        <strong>{a.name || 'APPELANT INCONNU'}</strong>
                        <div className={styles.locationSmall}>{a.station_id ? stations.find(s => s.id === a.station_id)?.name : '⚠️ Non assigné'}</div>
                      </div>
                      {a.status === 'pending' && (
                        <select
                          className={styles.assignSelect}
                          style={{ width: '100%', marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#1e293b', color: '#fff', border: '1px solid #334155', fontWeight: 700 }}
                          value={a.station_id || ''}
                          onClick={e => e.stopPropagation()}
                          onChange={e => updateAlertStation(a.id, e.target.value)}
                        >
                          <option value="">— Assigner une caserne —</option>
                          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </>
              )}

              {currentView === 'dispatch' && (
                <>
                  <div className={styles.mgmtHeader}>
                    <h2 className={styles.mgmtTitle}>DISPATCH CENTRAL</h2>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className={styles.btnMgmtAdd} style={{ background: '#e11d48' }} onClick={async () => {
                        await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'TEST SOS', type: 'medical', phone: '0700000000', lat: 5.31, lng: -4.0 }) });
                        fetchData();
                      }}>⚠ SIMULER SOS</button>
                      <button className={styles.btnMgmtAdd} onClick={() => fetchData()}>↻ Actualise</button>
                    </div>
                  </div>
                  <input className={styles.searchBar} placeholder="Rechercher..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                  <div className={styles.filterTabs}>
                    {['all', 'pending', 'dispatched', 'resolved'].map(f => (
                      <button key={f} className={filter === f ? styles.activeTab : ''} onClick={() => setFilter(f)}>
                        {f === 'all' ? 'Tout' : f === 'pending' ? 'SOS' : f === 'dispatched' ? 'Engagés' : 'Clôturés'}
                      </button>
                    ))}
                  </div>
                  {filteredAlerts.map(a => (
                    <div key={a.id} className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''}`} onClick={() => { setSelectedAlert(a); setCurrentView('map'); }}>
                      <div className={styles.cardHeader}>
                        <span className={`${styles.typeBadge} ${styles[a.type] || ''}`}>{a.type?.toUpperCase()}</span>
                        <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString('fr-FR')}</span>
                      </div>
                      <div className={styles.cardBody}>
                        <strong>{a.name || 'ANONYME'}</strong>
                        <div className={styles.locationSmall}>{a.station_id ? stations.find(s => s.id === a.station_id)?.name : '⚠️ NON ASSIGNÉ'}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {currentView === 'stations' && (
                <div className={styles.fleetView}>
                  <div className={styles.mgmtHeader}>
                    <h3 className={styles.mgmtTitle}>CASERNES ({stations.length})</h3>
                    <button className={styles.btnMgmtAdd} onClick={() => setIsAddingStation(true)}>+ Ajouter</button>
                  </div>
                  {stations.map(s => (
                    <div key={s.id} className={styles.fleetCardAdmin}>
                      <div className={styles.fleetMeta}>
                        <div className={styles.fleetMetaInfo}>
                          <strong>{s.name}</strong>
                          <span style={{ color: '#64748b', fontSize: 12 }}>{s.city} · {units.filter(u => u.station_id === s.id).length} unité(s)</span>
                        </div>
                        <span className={`${styles.fleetStatus} ${s.status === 'active' ? styles.active : ''}`}>{s.status === 'active' ? 'EN LIGNE' : 'INDISP.'}</span>
                      </div>
                      <div className={styles.fleetActions}>
                        <button className={styles.btnFleetEdit} onClick={() => setEditingStation(s)}>Modifier</button>
                        <button className={styles.btnFleetDelete} onClick={() => deleteStation(s.id)}>🗑️</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {currentView === 'analytics' && (
                <>
                  <div className={styles.mgmtHeader}><h2 className={styles.mgmtTitle}>ANALYTIQUES</h2></div>
                  <div className={styles.statsGrid}>
                    <div className={styles.statCard}><span className={styles.statVal}>{alerts.length}</span><span className={styles.statLabel}>Alertes Totales</span></div>
                    <div className={styles.statCard}><span className={styles.statVal}>{alerts.filter(a => a.status === 'resolved').length}</span><span className={styles.statLabel}>Résolues</span></div>
                    <div className={styles.statCard}><span className={styles.statVal}>{stations.length}</span><span className={styles.statLabel}>Casernes</span></div>
                    <div className={styles.statCard}><span className={styles.statVal}>{units.length}</span><span className={styles.statLabel}>Unités</span></div>
                  </div>
                </>
              )}
            </>
          ) : (
            /* ── Vue CASERNE ────────────────────────────────────────────────── */
            <>
              <div className={styles.filterTabs} style={{ marginBottom: 16 }}>
                <button className={currentView === 'dispatch' ? styles.activeTab : ''} onClick={() => { setCurrentView('dispatch'); setFilter('all'); }}>🚨 ALERTES</button>
                <button className={currentView === 'stations' ? styles.activeTab : ''} onClick={() => setCurrentView('stations')}>🚒 FLOTTE</button>
                <button className={currentView === 'history' ? styles.activeTab : ''} onClick={() => { setCurrentView('history'); setFilter('resolved'); }}>📜 HISTORIQUE</button>
              </div>

              {currentView === 'stations' && (
                <>
                  <div className={styles.mgmtHeader} style={{ marginTop: 10 }}>
                    <h3 className={styles.mgmtTitle}>NOS UNITÉS</h3>
                    <button className={styles.btnMgmtAdd} style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setIsAddingUnit(true)}>+ AJOUTER</button>
                  </div>
                  {units.filter(u => u.station_id === user?.id).map(u => (
                    <div key={u.id} className={styles.fleetCardAdmin}>
                      <div>
                        <strong>{u.name}</strong>
                        <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>{u.type} · ID: {u.id}</span>
                        <div>
                          <span style={{
                            background: u.status === 'available' ? '#10b98122' : u.status === 'en_route' ? '#f59e0b22' : '#e11d4822',
                            color: u.status === 'available' ? '#10b981' : u.status === 'en_route' ? '#f59e0b' : '#e11d48',
                            padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                          }}>
                            {u.status?.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => deleteUnit(u.id)} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}>🗑️</button>
                    </div>
                  ))}
                  {units.filter(u => u.station_id === user?.id).length === 0 && <p className={styles.noAlerts}>Aucune unité rattachée.</p>}
                </>
              )}

              {(currentView === 'dispatch' || currentView === 'history') && (
                <>
                  {filteredAlerts.length === 0 && <p className={styles.noAlerts}>{currentView === 'dispatch' ? 'Aucune alerte active.' : 'Aucun historique.'}</p>}
                  {filteredAlerts.map(a => (
                    <div key={a.id} className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''} ${selectedAlert?.id === a.id ? styles.tacticalSelected : ''}`} onClick={() => setSelectedAlert(a)}>
                      <div className={styles.cardHeader}>
                        <span className={`${styles.typeBadge} ${styles[a.type] || ''}`}>{a.type?.toUpperCase()}</span>
                        <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString('fr-FR')}</span>
                      </div>
                      <div className={styles.cardBody}>
                        {a.photo_url && (
                          <div className={styles.cardPhotoThumb}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.photo_url} alt="SOS" onClick={e => { e.stopPropagation(); setViewingPhoto(a.photo_url); }} />
                          </div>
                        )}
                        <div className={styles.cardInfoCol}>
                          <div className={styles.callerInfo}>
                            <strong>{a.name || 'ALERTE SOS'}</strong>
                            <span>{a.phone}</span>
                          </div>
                          <div className={styles.locationSmall}>📝 {a.notes || 'Aucun détail.'}</div>
                        </div>
                      </div>
                      {a.status === 'resolved' && a.report && (
                        <div className={styles.missionReportSummary}>
                          <div className={styles.reportTag}>RAPPORT D'INTERVENTION</div>
                          <p><strong>Actions:</strong> {a.report.actions}</p>
                          <p><strong>Bilan:</strong> {a.report.victimes}</p>
                        </div>
                      )}
                      <div className={styles.cardActions}>
                        {a.status === 'pending' && (
                          <select
                            className={styles.assignSelect}
                            style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#e11d48', color: 'white', fontWeight: 'bold', border: 'none' }}
                            value=""
                            onClick={e => e.stopPropagation()}
                            onChange={e => { if (e.target.value) socketRef.current?.emit('assign_unit', { alertId: a.id, unitId: e.target.value }); }}
                          >
                            <option value="">🚀 DÉPLOYER UNE UNITÉ</option>
                            {units.filter(u => u.station_id === user?.id && u.status === 'available').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        )}
                        {(a.status === 'dispatched' || a.status === 'en_route') && (
                          <div style={{ padding: '8px', textAlign: 'center', fontWeight: 700, color: '#10b981', background: 'rgba(16,185,129,0.1)', borderRadius: 6, fontSize: 13 }}>
                            ✓ Unité en intervention
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ── Mode Crise Banner ────────────────────────────────────────────────── */}
      {isCrisisMode && (
        <div className={styles.crisisBanner}>
          🚨 ALERTE NATIONALE : MODE CRISE ACTIVÉ — TOUTES LES UNITÉS MOBILISÉES 🚨
        </div>
      )}

      {/* ── Modal Caserne ─────────────────────────────────────────────────────── */}
      {(isAddingStation || editingStation) && (
        <div className={styles.emergencyModal}>
          <div className={styles.adminCard}>
            <h2>{editingStation ? 'MODIFIER LA CASERNE' : 'NOUVELLE CASERNE'}</h2>
            <form onSubmit={createOrUpdateStation} className={styles.adminForm}>
              <div className={styles.formGroup}><label>Nom</label><input name="name" type="text" defaultValue={editingStation?.name || ''} placeholder="GSPM Bingerville" required /></div>
              <div className={styles.formGroup}><label>Ville</label><input name="city" type="text" defaultValue={editingStation?.city || ''} placeholder="Abidjan" required /></div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}><label>Latitude</label><input name="lat" type="number" step="0.000001" defaultValue={editingStation?.lat || ''} placeholder="5.33..." required /></div>
                <div className={styles.formGroup}><label>Longitude</label><input name="lng" type="number" step="0.000001" defaultValue={editingStation?.lng || ''} placeholder="-4.02..." required /></div>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className={styles.btnSaveAdmin}>{editingStation ? 'ENREGISTRER' : 'CRÉER'}</button>
                <button type="button" onClick={() => { setIsAddingStation(false); setEditingStation(null); }} className={styles.btnCancelAdmin}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Ajouter Unité ───────────────────────────────────────────────── */}
      {isAddingUnit && (
        <div className={styles.unitModalOverlay}>
          <div className={styles.unitModal}>
            <h2>AJOUTER UNE UNITÉ</h2>
            <form onSubmit={addUnit} className={styles.unitForm}>
              <div className={styles.formGroup}><label>ID Tactique (ex: AMB-02)</label><input name="unitId" type="text" placeholder="ID de connexion" required /></div>
              <div className={styles.formGroup}><label>Nom de l'Unité</label><input name="unitName" type="text" placeholder="Ambulance Marcory" required /></div>
              <div className={styles.formGroup}>
                <label>Type</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {[{ id: 'fire', label: 'Incendie', icon: '🚒' }, { id: 'ambulance', label: 'Ambulance', icon: '🚑' }, { id: 'moto', label: 'Moto', icon: '🏍️' }, { id: 'command', label: 'Commandement', icon: '🚙' }].map(t => (
                    <button key={t.id} type="button" onClick={() => setNewUnitType(t.id)}
                      style={{ padding: '8px 12px', borderRadius: 10, border: `2px solid ${newUnitType === t.id ? '#3b82f6' : '#334155'}`, background: newUnitType === t.id ? '#3b82f620' : 'transparent', color: '#fff', cursor: 'pointer' }}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="submit" className={styles.btnSubmit}>AJOUTER À LA FLOTTE</button>
                <button type="button" onClick={() => setIsAddingUnit(false)} className={styles.btnCancel}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Popup Nouvelle Alerte ─────────────────────────────────────────────── */}
      {newAlertPopup && (
        <div className={styles.emergencyModal}>
          <div className={styles.emergencyCard}>
            <div className={styles.emergencyHeader}>
              <div className={styles.sirenIcon}>🚨</div>
              <h1>NOUVELLE ALERTE SOS</h1>
            </div>
            <div className={styles.emergencyBody}>
              <div className={styles.emergencyType}>{newAlertPopup.type?.toUpperCase()}</div>
              {newAlertPopup.photo_url && (
                <div className={styles.emergencyPhotoThumb} onClick={() => setViewingPhoto(newAlertPopup.photo_url)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={newAlertPopup.photo_url} alt="Alerte" />
                </div>
              )}
              <div className={styles.emergencyMetaDetail}>
                <p><strong>PROVENANCE:</strong> {newAlertPopup.name || 'POSITION DÉTECTÉE'}</p>
                <p><strong>CONTACT:</strong> {newAlertPopup.phone || 'N/A'}</p>
                <div className={styles.emergencyNotes}><strong>DÉTAILS:</strong><br />{newAlertPopup.notes || 'Aucun détail.'}</div>
              </div>
            </div>
            <div className={styles.emergencyActions}>
              <button className={styles.btnAccept} onClick={() => { setSelectedAlert(newAlertPopup); setNewAlertPopup(null); }}>VOIR ET ASSIGNER</button>
              <button className={styles.btnIgnore} onClick={() => setNewAlertPopup(null)}>Ignorer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Rapport ─────────────────────────────────────────────────────── */}
      {reportingAlert && (
        <div className={styles.emergencyModal}>
          <div className={styles.reportCard}>
            <div className={styles.reportHeader}>
              <h1>RAPPORT D'INTERVENTION</h1>
              <p>Mission : {reportingAlert.type?.toUpperCase()} — {reportingAlert.name}</p>
            </div>
            <form className={styles.reportForm} onSubmit={(e) => {
              e.preventDefault();
              const f = e.target as any;
              updateAlertStatus(reportingAlert.id, 'resolved', { actions: f.actions.value, conclusion: f.conclusion.value, victimes: f.victimes.value, timestamp: new Date() });
            }}>
              <div><label>Actions Prises</label><textarea name="actions" required placeholder="Ex: Extinction, Soins prodigués..." /></div>
              <div><label>Victimes / Bilan</label><input type="text" name="victimes" placeholder="Ex: 1 blessé léger" /></div>
              <div><label>Conclusion</label>
                <select name="conclusion" required>
                  <option value="success">Mission Réussie — Retour disponible</option>
                  <option value="transferred">Transféré (Police, SAMU)</option>
                  <option value="false_alarm">Fausse Alerte</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="submit" className={styles.btnSubmitReport}>Soumettre</button>
                <button type="button" className={styles.btnIgnore} onClick={() => setReportingAlert(null)}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Chat Tactique ─────────────────────────────────────────────────────── */}
      <div className={`${styles.chatContainer} ${!isChatExpanded ? styles.chatCollapsed : ''}`}>
        <div className={styles.chatHeader} onClick={() => { setIsChatExpanded(!isChatExpanded); setUnreadCount(0); }}>
          <div className={styles.chatHeaderLeft}>
            <span className={styles.chatHeaderStatus} />
            <span className={styles.chatHeaderTitle}>LIAISON TACTIQUE</span>
          </div>
          {unreadCount > 0 && <span className={styles.unreadTag}>{unreadCount}</span>}
          <button className={styles.btnToggleChat}>{isChatExpanded ? '▼' : 'COMMUNICATION'}</button>
        </div>
        {isChatExpanded && (
          <>
            <div className={styles.chatContent}>
              {messages.length === 0 && <p className={styles.noMessages}>En attente d'ordres du QG...</p>}
              {messages.map((m, i) => (
                <div key={i} className={`${styles.messageBubble} ${m.sender_id === user?.id ? styles.mine : ''}`}>
                  <div className={styles.msgHeader}>
                    <span className={styles.msgSender}>{m.sender_id === 'admin' ? 'QG CENTRAL' : m.sender_name}</span>
                    {m.recipient_id !== 'all' && <span className={styles.msgTag}>DIRECT</span>}
                  </div>
                  <p className={styles.msgText}>{m.content || m.text}</p>
                  <span className={styles.msgTime}>{new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className={styles.chatRecipientArea}>
              <label>Vers:</label>
              <select value={chatRecipient} onChange={e => setChatRecipient(e.target.value)} className={styles.recipientSelect}>
                <option value="all">TOUS (BROADCAST)</option>
                {user?.id !== 'admin' && <option value="admin">QG CENTRAL</option>}
                {user?.id === 'admin' && stations.map(s => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
              </select>
            </div>
            <form onSubmit={sendMessage} className={styles.chatInputArea}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Message tactique..." />
              <button type="submit">→</button>
            </form>
          </>
        )}
      </div>

      {/* ── Bannière Audio ────────────────────────────────────────────────────── */}
      {!audioEnabled && (
        <div className={styles.audioBanner} onClick={enableAudio}>
          ⚠️ CLIQUEZ ICI POUR ACTIVER LES ALERTES SONORES
        </div>
      )}

      {/* ── Photo Viewer ──────────────────────────────────────────────────────── */}
      {viewingPhoto && (
        <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
          <div className={styles.photoViewerContent} onClick={e => e.stopPropagation()}>
            <button className={styles.btnClosePhoto} onClick={() => setViewingPhoto(null)}>✕</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewingPhoto} alt="Zoom Alerte" className={styles.photoViewerImage} />
          </div>
        </div>
      )}
    </main>
  );
}

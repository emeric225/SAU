'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import io from 'socket.io-client';
import styles from './dashboard.module.css';

// Dynamic import for Leaflet
const Map = dynamic(() => import('@/components/Map'), { 
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder}>Chargement de la carte tactique...</div>
});

 
export default function Dashboard() {
  const socketRef = useRef<any>(null);
  const [stations, setStations] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [kpis, setKpis] = useState({ activeRescues: 0, totalToday: 0, avgResponseTime: '8 min' });
  const [units, setUnits] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [stationStatus, setStationStatus] = useState('available');
  const [newAlertPopup, setNewAlertPopup] = useState<any>(null);
  const [isAddingStation, setIsAddingStation] = useState(false);
  const [editingStation, setEditingStation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [reportingAlert, setReportingAlert] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [chatRecipient, setChatRecipient] = useState('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const userRef = useRef<any>(null);

  // --- Navigation / Engagement Opérationnel ---
  const [navigationActive, setNavigationActive] = useState(false);
  const [missionAlert, setMissionAlert] = useState<any>(null);
  const [etaData, setEtaData] = useState<{ distanceKm: number; durationMin: number; segmentCount: number } | null>(null);
  const [segmentProgress, setSegmentProgress] = useState(0);
  const [etaWarning, setEtaWarning] = useState(false);
  const prevRemainingRef = useRef<number | null>(null);

  // --- HQ Features State ---
  const [currentView, setCurrentView] = useState('map'); // map, dispatch, stations, analytics
  const [isCrisisMode, setIsCrisisMode] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [newUnitType, setNewUnitType] = useState('fire');


  // Siren Sound Generator (Web Audio API)
  const playSiren = () => {
    // Check ref directly to avoid stale closure issues
    if (!audioCtxRef.current) {
      console.warn("[SAU] Audio non initialisé. Cliquez sur la bannière.");
      return;
    }
    
    try {
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      let count = 0;
      const interval = setInterval(() => {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(count % 2 === 0 ? 800 : 1000, t);
        
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
        
        count++;
        if (count >= 30) clearInterval(interval);
      }, 500);
    } catch (e) { console.error("Audio error", e); }
  };

  const handleDownloadPhoto = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `SAU-OS-Alert-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Failed to download image', e);
      window.open(url, '_blank');
    }
  };

  const fetchData = async (userIdOverride?: string) => {
    try {
      let currentId = userIdOverride || user?.id;
      if (!currentId) {
        try { currentId = JSON.parse(localStorage.getItem('sau_station') || '{}').id; } catch (e) {}
      }
      const [sData, aData, kData, mData, uData] = await Promise.all([
        fetch('/api/stations').then(r => r.json()),
        fetch('/api/alerts').then(r => r.json()),
        fetch('/api/kpis').then(r => r.json()),
        fetch(`/api/messages?userId=${currentId}`).then(r => r.json()),
        fetch('/api/units').then(r => r.json())
      ]);
      setStations(sData);
      // Sort alerts: newest first on every fetch
      setAlerts([...aData].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setKpis(kData);
      // Deduplicate messages on fetch
      setMessages(prev => {
        const existing = new Set(prev.map(m => `${m.timestamp}_${m.text}`));
        const filtered = mData.filter((m: any) => !existing.has(`${m.timestamp}_${m.text}`));
        return [...prev, ...filtered].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });
      setUnits(uData);
      setLoading(false);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setLoading(false);
    }
  };

  useEffect(() => {
    // 1. Initialize Socket.io with direct connection for stability
    if (!socketRef.current) {
       const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
       socketRef.current = io(serverUrl, {
          transports: ['websocket', 'polling'],
          autoConnect: true,
          reconnection: true
       });
    }
    const socket = socketRef.current;

    const session = localStorage.getItem('sau_station');
    if (!session || session === 'undefined') {
      window.location.href = '/login';
      return;
    }
    let userData;
    try {
      userData = JSON.parse(session);
    } catch(e) {
      window.location.href = '/login';
      return;
    }
    setUser(userData);
    userRef.current = userData;
    setMounted(true);

    socket.on('connect', () => {
      console.log("[SAU] Liaison tactique établie.");
      setIsConnected(true);
      // ALWAYS re-join room using the mount-time identity on connection
      socket.emit('join_room', userData.id);
    });

    socket.on('disconnect', () => {
      console.log("[SAU] Liaison tactique perdue.");
      setIsConnected(false);
    });

    setChatRecipient(userData.id === 'admin' ? 'all' : 'admin');

    fetchData(userData.id);

    socket.on('new_alert', (newAlert: any) => {
      setAlerts(prev => {
        // New alerts go to the top, sorted by created_at desc
        const updated = [newAlert, ...prev.filter(a => a.id !== newAlert.id)];
        return updated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      
      // Only show emergency popup if admin OR the alert is assigned to this station
      if (userData.id === 'admin' || newAlert.station_id === userData.id) {
        setNewAlertPopup(newAlert);
        playSiren();
      }
      
      // Automatic ACK for receiving station
      if (userData.id !== 'admin' && newAlert.station_id === userData.id) {
        socket.emit('alert_viewed', newAlert.id);
      }

      if (Notification.permission === 'granted') {
        new Notification('🚨 NOUVELLE ALERTE SOS', {
          body: `${newAlert.type.toUpperCase()} par ${newAlert.name || 'Anonyme'}`,
        });
      }
    });

    socket.on('receive_message', (msg: any) => {
      setMessages(prev => {
        const isDup = prev.some(m => m.timestamp === msg.timestamp && m.text === msg.text);
        if (isDup) return prev;
        return [...prev, msg].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      });
      
      // If chat is collapsed and message is for us, increment unread
      setIsChatExpanded(expanded => {
        if (!expanded) setUnreadCount(c => c + 1);
        return expanded;
      });
    });

    socket.on('alert_updated', (updatedAlert: any) => {
      setAlerts(prev => {
        const exists = prev.find(a => a.id === updatedAlert.id);
        let newAlerts: any[];
        if (exists) {
          newAlerts = prev.map(a => a.id === updatedAlert.id ? { ...a, ...updatedAlert } : a);
        } else {
          // Alert not in list yet — add it at the top
          newAlerts = [updatedAlert, ...prev];
        }
        // Always keep sorted: most recent first
        return newAlerts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });

      // If this station just got assigned this alert → trigger alarm + popup
      if (userData?.id !== 'admin' && updatedAlert.station_id === userData?.id) {
        // Only trigger alarm if alert is newly assigned (not yet viewed)
        if (!updatedAlert.viewed_at && updatedAlert.status !== 'resolved') {
          setNewAlertPopup(updatedAlert);
          playSiren();
          socket.emit('alert_viewed', updatedAlert.id);
          if (Notification.permission === 'granted') {
            new Notification('🚨 ALERTE ASSIGNÉE À VOTRE CASERNE', {
              body: `${updatedAlert.type?.toUpperCase()} — ${updatedAlert.name || 'Anonyme'}`,
            });
          }
        }
      }
    });

    socket.on('station_updated', (updatedStation: any) => {
      setStations(prev => prev.map(s => s.id === updatedStation.id ? { ...s, ...updatedStation } : s));
    });

    socket.on('crisis_update', (data: any) => {
      setIsCrisisMode(data.active);
      if (data.active) playSiren();
    });

    socket.on('stations_list_updated', (data: any) => {
      if (Array.isArray(data)) {
        setStations(data);
      } else {
        // Fallback if server sends single object
        setStations(prev => {
          const exists = prev.some(s => s.id === data.id);
          if (exists) return prev.map(s => s.id === data.id ? { ...s, ...data } : s);
          return [...prev, data];
        });
      }
    });

    socket.on('unit_moved', (updatedUnit: any) => {
      setUnits(prev => prev.map(u => u.id === updatedUnit.id ? { ...u, lat: updatedUnit.lat, lng: updatedUnit.lng } : u));
    });

    socket.on('unit_updated', (updatedUnit: any) => {
      setUnits(prev => prev.map(u => u.id === updatedUnit.id ? { ...u, ...updatedUnit } : u));
    });

    socket.on('unit_deleted', (deletedId: string) => {
      setUnits(prev => prev.filter(u => u.id !== deletedId));
    });


    if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    // Auto-refresh every 15s to keep station dashboard in sync
    const refreshInterval = setInterval(() => fetchData(), 15000);

    return () => {
      clearInterval(refreshInterval);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('new_alert');
      socket.off('alert_updated');
      socket.off('station_updated');
      socket.off('receive_message');
      socket.off('crisis_update');
      socket.off('stations_list_updated');
      socket.off('unit_moved');
      socket.off('unit_updated');
      socket.off('unit_deleted');
    };

  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateAlertStatus = async (id: string, status: string, report?: any) => {
    // Enforcement: If station trying to resolve, MUST show report modal first
    if (status === 'resolved' && user?.id !== 'admin' && !report) {
      const alert = alerts.find(a => a.id === id);
      setReportingAlert(alert);
      return;
    }

    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, report })
      });
      if (res.ok) {
        setReportingAlert(null);
        fetchData();
      }
    } catch (err) {
      console.error("Update status error:", err);
    }
  };

  const updateAlertNotes = async (id: string, notes: string) => {
    try {
      await fetch(`/api/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes })
      });
      fetchData();
    } catch (err) {
      console.error("Update notes error:", err);
    }
  };

  const toggleStation = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'available' ? 'busy' : 'available';
      setStationStatus(newStatus);
      await fetch(`/api/stations/status/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (err) {
      console.error("Toggle station error:", err);
    }
  };

  const updateAlertStation = async (alertId: string, stationId: string) => {
    try {
      await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station_id: stationId })
      });
      fetchData();
    } catch (err) { console.error("Error updated alert station", err); }
  };

  const deleteStation = async (id: string) => {
     if (!confirm("Supprimer cette caserne ?")) return;
     try {
       await fetch(`/api/stations/${id}`, { method: 'DELETE' });
       fetchData();
     } catch (err) { console.error("Delete station error", err); }
  };

  const addUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const id = formData.get('id') as string;
    const name = formData.get('name') as string;
    
    if (!id || !name) return;

    try {
      await fetch('/api/units', {
         method: 'POST',
         headers:{'Content-Type':'application/json'},
         body: JSON.stringify({ id, name, type: newUnitType, station_id: user?.id })
      });
      setIsAddingUnit(false);
      fetchData();
    } catch (err) { console.error(err); }
  };

  const deleteUnit = async (id: string) => {
    if(!confirm("Supprimer cette unité ?")) return;
    try {
      await fetch(`/api/units/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) { console.error(err); }
  };

  const toggleCrisisMode = () => {
    const newState = !isCrisisMode;
    setIsCrisisMode(newState);
    socketRef.current?.emit('toggle_crisis', newState);
  };

  const createOrUpdateStation = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = {
      name: formData.get('name'),
      city: formData.get('city'),
      lat: formData.get('lat'),
      lng: formData.get('lng'),
    };

    try {
      const url = editingStation ? `/api/stations/${editingStation.id}` : '/api/stations';
      const method = editingStation ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        setIsAddingStation(false);
        setEditingStation(null);
        fetchData();
      }
    } catch (err) { console.error("Error saving station", err); }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !socketRef.current) return;
    const msg = {
      sender_id: user?.id,
      sender_name: user?.name,
      recipient_id: chatRecipient,
      text: chatInput,
    };
    socketRef.current.emit('send_message', msg);
    setChatInput('');
  };

  const handleLogout = () => {
    localStorage.removeItem('sau_station');
    window.location.href = '/login';
  };

  // --- Mission Functions ---
  const startMission = useCallback((alert: any) => {
    setMissionAlert(alert);
    setSelectedAlert(alert);
    setNavigationActive(true);
    setSegmentProgress(0);
    setEtaWarning(false);
    prevRemainingRef.current = null;
    // Mark station as busy
    if (user?.id) {
      fetch(`/api/stations/status/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'busy' })
      });
      setStationStatus('busy');
    }
    // Notify HQ via socket
    socketRef.current?.emit('unit_transit', {
      alertId: alert.id,
      stationId: user?.id,
      stationName: user?.name,
    });
  }, [user]);

  const cancelMission = useCallback(() => {
    setNavigationActive(false);
    setMissionAlert(null);
    setEtaData(null);
    setSegmentProgress(0);
  }, []);

  // Compute remaining ETA (recalculated on each segment advance)
  const remainingMin = etaData
    ? etaData.durationMin * Math.max(0, 1 - segmentProgress / Math.max(etaData.segmentCount - 1, 1))
    : null;

  const progressPct = etaData
    ? Math.min(100, (segmentProgress / Math.max(etaData.segmentCount - 1, 1)) * 100)
    : 0;

  // ETA warning: if remaining suddenly increases (reroute / traffic)
  useEffect(() => {
    if (remainingMin !== null && prevRemainingRef.current !== null) {
      setEtaWarning(remainingMin > prevRemainingRef.current + 0.1);
    }
    if (remainingMin !== null) prevRemainingRef.current = remainingMin;
  }, [remainingMin]);

  const filteredAlerts = alerts.filter(a => {
    // Search filter
    if (searchTerm && !a.name?.toLowerCase().includes(searchTerm.toLowerCase()) && !a.phone?.includes(searchTerm)) return false;
    
    // Admin sees all, Station sees only theirs (with better check)
    if (user?.id !== 'admin' && a.station_id !== user?.id) return false;
    
    // TAB LOGIC for STATION
    if (user?.id !== 'admin') {
      if (currentView === 'history') return a.status === 'resolved';
      if (currentView === 'dispatch') return a.status !== 'resolved';
    }

    // Status filter for ADMIN
    if (filter === 'all') return true;
    return a.status === filter;
  });

  // --- HQ View Components ---
  const renderDispatchView = () => (
    <>
      <div className={styles.mgmtHeader}>
        <h2 className={styles.mgmtTitle}>DISPATCH CENTRAL</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
           <button className={styles.btnMgmtAdd} style={{ background: '#e11d48' }} onClick={async () => {
              await fetch('/api/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: "TEST SOS RUE 12", type: "medical", phone: "0700010203", lat: 5.31, lng: -4.0, photo_url: "" })
              });
              fetchData();
           }}>⚠ SIMULER SOS</button>
           <button className={styles.btnMgmtAdd} onClick={() => fetchData()}>Actualiser</button>
        </div>
      </div>
      <div className={styles.filterTabs}>
        <button className={filter === 'all' ? styles.activeTab : ''} onClick={() => setFilter('all')}>Tout</button>
        <button className={filter === 'pending' ? styles.activeTab : ''} onClick={() => setFilter('pending')}>Urgences</button>
        <button className={filter === 'dispatched' ? styles.activeTab : ''} onClick={() => setFilter('dispatched')}>Engagés</button>
      </div>
      <input 
        className={styles.searchBar} 
        placeholder="Rechercher une alerte (nom, téléphone...)" 
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      {filteredAlerts.length === 0 && <p className={styles.noAlerts}>Aucune alerte active.</p>}
      {filteredAlerts.map(a => (
        /* Reusing tacticalCard style but for HQ */
        <div key={a.id} className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''}`} onClick={() => { setSelectedAlert(a); setCurrentView('map'); }}>
          <div className={styles.cardHeader}>
             <span className={`${styles.typeBadge} ${styles[a.type]}`}>{a.type.toUpperCase()}</span>
             <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString()}</span>
          </div>
          <div className={styles.cardBody}>
             <strong>{a.name || 'ANONYME'}</strong>
             <div className={styles.locationSmall}>
               {a.station_id ? `Asségné à : ${stations.find(s => s.id === a.station_id)?.name}` : '⚠️ NON ASSIGNÉ'}
             </div>
          </div>
        </div>
      ))}
    </>
  );

  const renderAnalyticsView = () => (
    <>
      <div className={styles.mgmtHeader}>
        <h2 className={styles.mgmtTitle}>ANALYTICS</h2>
      </div>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statVal}>{alerts.length}</span>
          <span className={styles.statLabel}>Alertes Totales</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statVal}>{stations.length}</span>
          <span className={styles.statLabel}>Casernes actives</span>
        </div>
        <div className={`${styles.statCard} ${styles.wideStat}`}>
          <div className={styles.statCol}>
             <span className={styles.statLabel}>Temps Réponse</span>
             <span className={styles.statVal} style={{ color: '#10b981' }}>6.2 min</span>
          </div>
          <div className={styles.statCol} style={{ textAlign: 'right' }}>
             <span className={styles.statLabel}>Efficacité</span>
             <span className={styles.statVal}>94%</span>
          </div>
        </div>
      </div>
      <div className={styles.fleetCardAdmin} style={{ marginTop: '20px' }}>
        <strong>Répartition des Incidents</strong>
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden', display: 'flex', marginTop: '10px' }}>
          <div style={{ width: '45%', background: '#e11d48' }} />
          <div style={{ width: '35%', background: '#3b82f6' }} />
          <div style={{ width: '20%', background: '#fbbf24' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginTop: '5px' }}>
          <span>🔥 Feu</span>
          <span>🚑 Médical</span>
          <span>🚗 Accident</span>
        </div>
      </div>
    </>
  );

return (
  mounted ? (
    <main className={`${styles.mapContainer} ${isFullScreen ? styles.fullScreenMode : ''}`}>
        {isCrisisMode && <div className={styles.crisisOverlay} />}
        
        <Map
          stations={stations}
          alerts={user?.id === 'admin' ? alerts : alerts.filter(a => a.station_id === user?.id)}
          units={user?.id === 'admin' ? units : units.filter(u => u.station_id === user?.id && (u.status === 'en_route' || u.status === 'on_site'))}
          selectedAlert={selectedAlert}
          navigationActive={navigationActive}
          onRouteDataReady={(data) => { setEtaData(data); setSegmentProgress(0); }}
          onVehicleProgress={(seg) => setSegmentProgress(seg)}
        />
        
        {/* HQ SIDE NAV */}
        {user?.id === 'admin' && (
          <nav className={styles.hqSideNav}>
            <div className={styles.logoMini}>SAU</div>
            <div className={`${styles.navIcon} ${currentView === 'map' ? styles.activeNav : ''}`} title="Supervision Carte" onClick={() => setCurrentView('map')}>🗺️</div>
            <div className={`${styles.navIcon} ${currentView === 'dispatch' ? styles.activeNav : ''}`} title="Gestion Alertes" onClick={() => setCurrentView('dispatch')}>🚨</div>
            <div className={`${styles.navIcon} ${currentView === 'stations' ? styles.activeNav : ''}`} title="Gestion Casernes" onClick={() => setCurrentView('stations')}>🚒</div>
            <div className={`${styles.navIcon} ${currentView === 'analytics' ? styles.activeNav : ''}`} title="Statistiques" onClick={() => setCurrentView('analytics')}>📊</div>
            <div className={`${styles.navIcon} ${isCrisisMode ? styles.activeNav : ''}`} style={{ marginTop: 'auto', background: isCrisisMode ? '#e11d48' : '' }} title="MODE CRISE" onClick={toggleCrisisMode}>🔥</div>
            <div className={styles.navIcon} title="Plein Écran" onClick={() => setIsFullScreen(!isFullScreen)}>⛶</div>
          </nav>

        )}

        {/* Floating Sidebar Overlay (NOW DYNAMIC) */}
        <aside className={styles.mainPanel}>
          <header className={styles.panelHeader}>
            <div className={styles.stationBrand}>
              <div className={styles.stationInfo}>
                <div className={styles.stationTitleRow}>
                  <span className={styles.stationName}>{user?.name} {isCrisisMode && "— MODE CRISE"}</span>
                  <div className={`${styles.systemStatus} ${isConnected ? styles.online : styles.offline}`}>
                    {isConnected ? 'TACTICAL-LINK' : 'OFFLINE'}
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleLogout} className={styles.btnLogoutIcon}>🚪</button>
          </header>

          <div className={styles.panelScroll}>
            {user?.id === 'admin' ? (
              <>
                {currentView === 'map' && (
                  <>
                    <div className={styles.filterTabs}>
                      <button className={filter === 'all' ? styles.activeTab : ''} onClick={() => setFilter('all')}>Tout Abidjan</button>
                      <button className={filter === 'pending' ? styles.activeTab : ''} onClick={() => setFilter('pending')}>Urgences</button>
                    </div>
                    {filteredAlerts.map(a => (
                      <div key={a.id} className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''} ${selectedAlert?.id === a.id ? styles.tacticalSelected : ''}`} onClick={() => setSelectedAlert(a)}>
                         <div className={styles.cardHeader}>
                           <span className={`${styles.typeBadge} ${styles[a.type]}`}>{a.type.toUpperCase()}</span>
                           <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString()}</span>
                         </div>
                         <div className={styles.cardBody}>
                           <strong>{a.name || 'Appelant Inconnu'}</strong>
                           <div className={styles.locationSmall}>{a.station_id ? stations.find(s => s.id === a.station_id)?.name : '❌ Non assigné'}</div>
                         </div>
                         {a.status === 'pending' && (
                            <div className={styles.assignSelection}>
                          <select 
                            className={styles.assignSelect}
                            value={a.station_id || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => updateAlertStation(a.id, e.target.value)}
                          >
                            <option value="">Assigner Caserne</option>
                            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                            </div>
                         )}
                      </div>
                    ))}
                  </>
                )}
                {currentView === 'dispatch' && renderDispatchView()}
                {currentView === 'analytics' && renderAnalyticsView()}
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
                             <span>{s.city}</span>
                           </div>
                           <span className={`${styles.fleetStatus} ${styles[s.status || 'active']}`}>{s.status === 'active' ? 'EN LIGNE' : 'INDISP.'}</span>
                         </div>
                         <div className={styles.fleetActions}>
                            <button className={styles.btnFleetEdit} onClick={() => setEditingStation(s)}>Modifier</button>
                            <button className={styles.btnFleetDelete} onClick={() => deleteStation(s.id)}>🗑️</button>
                         </div>
                       </div>
                     ))}
                   </div>

                )}
              </>
            ) : (
              /* STATION VIEW (Remains simple or follows station logic) */
              <>
                <div className={styles.filterTabs} style={{ marginBottom: '16px', background: 'rgba(59, 130, 246, 0.1)' }}>
                  <button className={currentView === 'dispatch' ? styles.activeTab : ''} onClick={() => {setCurrentView('dispatch'); setFilter('all');}}>🚨 ALERTES</button>
                  <button className={currentView === 'units' ? styles.activeTab : ''} onClick={() => setCurrentView('units')}>🚒 FLOTTE</button>
                  <button className={currentView === 'history' ? styles.activeTab : ''} onClick={() => {setCurrentView('history'); setFilter('resolved');}}>📜 HISTORIQUE</button>
                </div>

                {currentView === 'units' && (
                  <>
                    <div className={styles.mgmtHeader} style={{marginTop: '10px'}}>
                      <h3 className={styles.mgmtTitle}>NOS UNITÉS</h3>
                      <button className={styles.btnMgmtAdd} style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => setIsAddingUnit(true)}>+ AJOUTER</button>
                    </div>
                    <div className={styles.fleetView} style={{ padding: '0 10px', marginBottom: '20px' }}>
                      {units.filter(u => u.station_id === user?.id).map(u => (
                        <div key={u.id} className={styles.fleetCardAdmin} style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
                          <div>
                            <div className={styles.fleetMetaInfo}>
                              <strong>{u.name}</strong> 
                              <span style={{ marginLeft: '5px' }}>({u.type} — Connexion: {u.id})</span>
                            </div>
                            <span className={`${styles.fleetStatus} ${u.status === 'available' ? styles.active : ''}`}>{u.status.toUpperCase()}</span>
                          </div>
                          <button onClick={() => deleteUnit(u.id)} style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer', alignSelf: 'center' }}>🗑️</button>
                        </div>
                      ))}
                      {units.filter(u => u.station_id === user?.id).length === 0 && <p className={styles.noAlerts}>Aucune flotte n'est rattachée.</p>}
                    </div>
                  </>
                )}

                {(currentView === 'dispatch' || currentView === 'history') && (
                  <>
                    <div className={styles.filterTabs}>
                      <button className={filter === 'all' ? styles.activeTab : ''} onClick={() => setFilter('all')}>{currentView === 'dispatch' ? 'Missions Actives' : 'Archives'}</button>
                      <button className={filter === 'pending' ? styles.activeTab : ''} onClick={() => setFilter('pending')}>SOS / Urgences</button>
                    </div>
                    {filteredAlerts.length === 0 && <p className={styles.noAlerts}>{currentView === 'dispatch' ? 'Aucune alerte active.' : 'Aucun historique.'}</p>}
                    {filteredAlerts.map(a => (
                      <div key={a.id} className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''} ${selectedAlert?.id === a.id ? styles.tacticalSelected : ''} ${a.status === 'resolved' ? styles.resolvedCard : ''}`} onClick={() => setSelectedAlert(a)}>
                        <div className={styles.cardHeader}>
                          <span className={`${styles.typeBadge} ${styles[a.type]}`}>{a.type.toUpperCase()}</span>
                          <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div className={styles.cardBody}>
                           {a.photo_url && (
                             <div className={styles.cardPhotoThumb}>
                               <img src={a.photo_url} alt="SOS" onClick={(e) => { e.stopPropagation(); setViewingPhoto(a.photo_url); }} />
                             </div>
                           )}
                           <div className={styles.cardInfoCol}>
                             <div className={styles.callerInfo}>
                               <strong>{a.name || 'ALERTE SOS'}</strong>
                               <span>{a.phone}</span>
                             </div>
                             <div className={styles.locationSmall}>📝 {a.notes || 'Aucun détail fourni.'}</div>
                           </div>
                           
                           {/* REPORT SECTION FOR HISTORY */}
                           {a.status === 'resolved' && a.report && (
                             <div className={styles.missionReportSummary}>
                               <div className={styles.reportTag}>RAPPORT D'INTERVENTION</div>
                               <p><strong>Actions:</strong> {a.report.actions}</p>
                               <p><strong>Bilan:</strong> {a.report.victimes}</p>
                               <div className={`${styles.conclusionBadge} ${styles[a.report.conclusion]}`}>
                                 {a.report.conclusion === 'success' ? 'SUCCÈS' : a.report.conclusion === 'false_alarm' ? 'FAUSSE ALERTE' : 'TRANSFÉRÉ'}
                               </div>
                             </div>
                           )}
                        </div>

                        <div className={styles.cardActions}>
                          {a.status === 'pending' && (
                            <select 
                              className={styles.assignSelect}
                              style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#e11d48', color: 'white', fontWeight: 'bold' }}
                              value=""
                              onClick={e => e.stopPropagation()}
                              onChange={(e) => {
                                if (e.target.value) {
                                  socketRef.current?.emit('assign_unit', { alertId: a.id, unitId: e.target.value });
                                }
                              }}
                            >
                              <option value="">🚀 DÉPLOYER UNITÉ</option>
                              {units.filter(u => u.station_id === user?.id && u.status === 'available').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          )}
                          {(a.status === 'dispatched' || a.status === 'en_route') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                              <div style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '6px' }}>
                                ✓ Unité en intervention
                              </div>
                              {user?.id === 'admin' && (
                                <button 
                                  className={styles.btnActionSuccess} 
                                  style={{ padding: '12px', fontSize: '12px' }}
                                  onClick={(e) => { e.stopPropagation(); updateAlertStatus(a.id, 'resolved'); }}
                                >
                                  ✅ CLÔTURER & RAPPORT
                                </button>
                               )}
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

        {isCrisisMode && (
          <div className={styles.crisisBanner}>
            🚨 ALERTE NATIONALE : MODE CRISE ACTIVÉ — TOUTES LES UNITÉS MOBILISÉES 🚨
          </div>
        )}


        {/* STATION CREATION/EDIT MODAL */}
        {(isAddingStation || editingStation) && (
          <div className={styles.emergencyModal}>
            <div className={styles.adminCard}>
              <h2>{editingStation ? 'MODIFIER LA CASERNE' : 'AJOUTER UNE NOUVELLE CASERNE'}</h2>
              <form onSubmit={createOrUpdateStation} className={styles.adminForm}>
                <div className={styles.formGroup}>
                  <label>Nom de la Caserne</label>
                  <input name="name" type="text" defaultValue={editingStation?.name || ''} placeholder="ex: GSPM Bingerville" required />
                </div>
                <div className={styles.formGroup}>
                  <label>Ville / Quartier</label>
                  <input name="city" type="text" defaultValue={editingStation?.city || ''} placeholder="ex: Abidjan" required />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Latitude</label>
                    <input name="lat" type="number" step="0.000001" defaultValue={editingStation?.lat || ''} placeholder="5.33..." required />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Longitude</label>
                    <input name="lng" type="number" step="0.000001" defaultValue={editingStation?.lng || ''} placeholder="-4.02..." required />
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnSaveAdmin}>{editingStation ? 'ENREGISTRER' : 'CRÉER L\'UNITÉ'}</button>
                  <button type="button" onClick={() => { setIsAddingStation(false); setEditingStation(null); }} className={styles.btnCancelAdmin}>Annuler</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ADD UNIT MODAL */}
        {isAddingUnit && (
          <div className={styles.unitModalOverlay}>
            <div className={styles.unitModal}>
              <h2>AJOUTER UNE UNITÉ D'INTERVENTION</h2>
              <form onSubmit={addUnit} className={styles.unitForm}>
                <div className={styles.formGroup}>
                  <label>Identifiant Tactique (ex: U10, AMB-02)</label>
                  <input name="id" type="text" placeholder="ID de connexion" required />
                </div>
                <div className={styles.formGroup}>
                  <label>Nom de l'Unité</label>
                  <input name="name" type="text" placeholder="ex: Fourgon Pompe Tonne" required />
                </div>
                <div className={styles.formGroup}>
                  <label>Type d'Unité</label>
                  <div className={styles.typeGrid}>
                    {[
                      { id: 'fire', label: 'Incendie', icon: '🚒' },
                      { id: 'ambulance', label: 'Ambulance', icon: '🚑' },
                      { id: 'moto', label: 'Moto Rapide', icon: '🏍️' },
                      { id: 'command', label: 'Commandement', icon: '🚙' },
                      { id: 'tanker', label: 'Camion-Citerne', icon: '🚚' }
                    ].map(t => (
                      <button 
                        key={t.id} 
                        type="button" 
                        className={`${styles.typeBtn} ${newUnitType === t.id ? styles.active : ''}`}
                        onClick={() => setNewUnitType(t.id)}
                      >
                        <span>{t.icon}</span>
                        {t.label}
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

        {/* Global Overlays (KPIs) */}
        {!navigationActive && (
          <div className={styles.kpiPanel}>
            <div className={styles.kpiItem}><span>{kpis.activeRescues}</span><label>INTERVENTIONS</label></div>
            <div className={styles.kpiDivider}></div>
            <div className={styles.kpiItem}><span>{kpis.totalToday}</span><label>SIGNALEMENTS</label></div>
          </div>
        )}

        {/* ETA WIDGET — Mode Engagement Opérationnel */}
        {navigationActive && etaData && (
          <div className={styles.etaWidget}>
            <div className={styles.etaHeader}>
              <span className={styles.etaSiren}>🚨</span>
              <span>EN TRANSIT</span>
              <span className={styles.etaSiren}>🚨</span>
            </div>
            <div className={styles.etaTimeRow}>
              <div className={`${styles.etaTime} ${etaWarning ? styles.etaWarning : ''}`}>
                {remainingMin !== null ? Math.ceil(remainingMin) : '--'}
                <span className={styles.etaUnit}>MIN</span>
              </div>
              <div className={styles.etaDistCol}>
                <span className={styles.etaDistVal}>{etaData.distanceKm.toFixed(1)}</span>
                <span className={styles.etaDistLabel}>km</span>
              </div>
            </div>
            {etaWarning && (
              <div className={styles.etaWarningMsg}>⚠️ RALENTISSEMENT DÉTECTÉ</div>
            )}
            <div className={styles.etaBarTrack}>
              <div
                className={styles.etaBarFill}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className={styles.etaFooter}>
              <span className={styles.etaProgressTxt}>{Math.round(progressPct)}% parcouru</span>
              <button className={styles.etaCancelBtn} onClick={cancelMission}>✕ Annuler</button>
            </div>
            {missionAlert && (
              <div className={styles.etaDestination}>
                📍 {missionAlert.type?.toUpperCase()} — {missionAlert.name || 'Anonyme'}
              </div>
            )}
          </div>
        )}

        {/* NEW ALERT POPUP (Emergency Modal) */}
        {newAlertPopup && (
          <div className={styles.emergencyModal}>
            <div className={styles.emergencyCard}>
              <div className={styles.emergencyHeader}>
                <div className={styles.sirenIcon}>🚨</div>
                <h1>NOUVELLE ALERTE SOS</h1>
              </div>
              <div className={styles.emergencyBody}>
                <div className={styles.emergencyType}>{newAlertPopup.type.toUpperCase()}</div>
                {newAlertPopup.photo_url && (
                    <div className={styles.emergencyPhotoThumb} onClick={() => setViewingPhoto(newAlertPopup.photo_url)}>
                       <img src={newAlertPopup.photo_url} alt="Alerte SOS" />
                    </div>
                )}
                <div className={styles.emergencyMetaDetail}>
                  <p><strong>PROVENANCE:</strong> {newAlertPopup.name || 'POSITION DÉTECTÉE'}</p>
                  <p><strong>CONTACT:</strong> {newAlertPopup.phone || 'NON DISPONIBLE'}</p>
                  <div className={styles.emergencyNotes}>
                    <strong>DÉTAILS:</strong><br/>
                    {newAlertPopup.notes || 'Aucun détail supplémentaire fourni.'}
                  </div>
                </div>
              </div>
              <div className={styles.emergencyActions}>
                <button 
                  className={styles.btnAccept} 
                  onClick={() => {
                    setSelectedAlert(newAlertPopup);
                    setNewAlertPopup(null);
                  }}
                >
                  VOIR DÉTAILS ET ASSIGNER
                </button>
                <button className={styles.btnIgnore} onClick={() => setNewAlertPopup(null)}>Ignorer</button>
              </div>
            </div>
          </div>
        )}

        {/* INTERVENTION REPORT POPUP */}
        {reportingAlert && (
          <div className={styles.emergencyModal}>
            <div className={styles.reportCard}>
              <div className={styles.reportHeader}>
                <h1>RAPPORT D'INTERVENTION</h1>
                <p>Mission : {reportingAlert.type.toUpperCase()} - {reportingAlert.name}</p>
              </div>
              <form 
                className={styles.reportForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const reportData = {
                    actions: form.actions.value,
                    conclusion: form.conclusion.value,
                    victimes: form.victimes.value,
                    timestamp: new Date()
                  };
                  updateAlertStatus(reportingAlert.id, 'resolved', reportData);
                  // Reset navigation state if it was the currently tracked mission
                  if (missionAlert?.id === reportingAlert.id) cancelMission();
                }}
              >
                <div>
                  <label>Actions Prises</label>
                  <textarea name="actions" required placeholder="Décrivez les actions effectuées (ex: Extinction, Balisage...)"></textarea>
                </div>
                <div>
                  <label>Victimes / Bilan</label>
                  <input type="text" name="victimes" placeholder="Ex: 1 blessé léger, pris en charge" />
                </div>
                <div>
                  <label>Conclusion</label>
                  <select name="conclusion" required>
                    <option value="success">Mission Réussie - Retour disponible</option>
                    <option value="transferred">Transféré à une autre autorité (Police, SAMU)</option>
                    <option value="false_alarm">Fausse Alerte</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                  <button type="submit" className={styles.btnSubmitReport}>Soumettre le Rapport</button>
                  <button type="button" className={styles.btnIgnore} onClick={() => setReportingAlert(null)}>Annuler</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TACTICAL CHAT OVERLAY */}
        <div className={`${styles.chatContainer} ${!isChatExpanded ? styles.chatCollapsed : ''}`}>
          <div className={styles.chatHeader} onClick={() => { setIsChatExpanded(!isChatExpanded); setUnreadCount(0); }}>
            <div className={styles.chatHeaderLeft}>
              <span className={styles.chatHeaderStatus}></span>
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
                      {m.recipient_id !== 'all' && (
                        <span className={styles.msgTag}>DIRECT</span>
                      )}
                    </div>
                    <p className={styles.msgText}>{m.text}</p>
                    <span className={styles.msgTime}>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              
              <div className={styles.chatRecipientArea}>
                <label>Vers:</label>
                <select 
                  value={chatRecipient} 
                  onChange={(e) => setChatRecipient(e.target.value)}
                  className={styles.recipientSelect}
                >
                  <option value="all">TOUS (BROADCAST)</option>
                  {user?.id !== 'admin' && <option value="admin">QG CENTRAL</option>}
                  {user?.id === 'admin' && stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <form onSubmit={sendMessage} className={styles.chatInputArea}>
                <input 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Envoyer un message tactique..."
                />
                <button type="submit">OK</button>
              </form>
            </>
          )}
        </div>

        {/* AUDIO ENABLE BANNER */}
        {!audioEnabled && (
          <div 
            className={styles.audioBanner} 
            onClick={() => {
              const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
              audioCtxRef.current = new AudioContextClass();
              audioCtxRef.current?.resume();
              setAudioEnabled(true);
            }}
          >
            ⚠️ CLIQUEZ ICI POUR ACTIVER LES ALERTES SONORES (SIRÈNE 15s)
          </div>
        )}

        {/* PHOTO VIEWER MODAL */}
        {viewingPhoto && (
          <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
            <div className={styles.photoViewerContent} onClick={(e) => e.stopPropagation()}>
              <button className={styles.btnClosePhoto} onClick={() => setViewingPhoto(null)}>✕</button>
              <img src={viewingPhoto} alt="Zoom Alerte" className={styles.photoViewerImage} />
              <div className={styles.photoViewerActions}>
                 <button className={styles.btnDownloadPhoto} onClick={() => handleDownloadPhoto(viewingPhoto)}>
                   📥 Télécharger l'image originelle
                 </button>
              </div>
            </div>
          </div>
        )}

      </main>
    ) : (
      <div className={styles.loadingFull}>Liaison sécurisée...</div>
    )
  );
}

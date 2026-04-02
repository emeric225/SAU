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
  const [activeTab, setActiveTab] = useState('alerts'); // 'alerts' or 'stations'
  const [filter, setFilter] = useState('all');
  const [kpis, setKpis] = useState({ activeRescues: 0, totalToday: 0, avgResponseTime: '8 min' });
  const [user, setUser] = useState<any>(null);
  const [stationStatus, setStationStatus] = useState('available');
  const [newAlertPopup, setNewAlertPopup] = useState<any>(null);
  const [isAddingStation, setIsAddingStation] = useState(false);
  const [showFleet, setShowFleet] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [reportingAlert, setReportingAlert] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(true);
  const [chatRecipient, setChatRecipient] = useState('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // --- Navigation / Engagement Opérationnel ---
  const [navigationActive, setNavigationActive] = useState(false);
  const [missionAlert, setMissionAlert] = useState<any>(null);
  const [etaData, setEtaData] = useState<{ distanceKm: number; durationMin: number; segmentCount: number } | null>(null);
  const [segmentProgress, setSegmentProgress] = useState(0);
  const [etaWarning, setEtaWarning] = useState(false);
  const prevRemainingRef = useRef<number | null>(null);

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

  const fetchData = async (userIdOverride?: string) => {
    try {
      const currentId = userIdOverride || user?.id || JSON.parse(localStorage.getItem('sau_station') || '{}').id;
      const [sData, aData, kData, mData] = await Promise.all([
        fetch('/api/stations').then(r => r.json()),
        fetch('/api/alerts').then(r => r.json()),
        fetch('/api/kpis').then(r => r.json()),
        fetch(`/api/messages?userId=${currentId}`).then(r => r.json())
      ]);
      setStations(sData);
      setAlerts(aData);
      setKpis(kData);
      setMessages(mData);
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
    if (!session) {
      window.location.href = '/login';
      return;
    }
    const userData = JSON.parse(session);
    setUser(userData);

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
      setAlerts(prev => [newAlert, ...prev]);
      setNewAlertPopup(newAlert);
      playSiren();
      
      // Automatic ACK for receiving station
      if (userData.id !== 'admin' && newAlert.station_id === userData.id) {
        socket.emit('alert_viewed', newAlert.id);
      }

      if (Notification.permission === 'granted') {
        new Notification("🚨 NOUVELLE ALERTE SOS", {
          body: `${newAlert.type.toUpperCase()} par ${newAlert.name || 'Anonyme'}`,
        });
      }
    });

    socket.on('receive_message', (msg: any) => {
      setMessages(prev => [...prev, msg]);
      
      // If chat is collapsed and message is for us, increment unread
      setIsChatExpanded(expanded => {
        if (!expanded) setUnreadCount(c => c + 1);
        return expanded;
      });
    });

    socket.on('alert_updated', (updatedAlert: any) => {
      setAlerts(prev => {
        const newAlerts = prev.map(a => a.id === updatedAlert.id ? { ...a, ...updatedAlert } : a);
        // Silent ACK: If assignment just arrived for us
        if (userData?.id !== 'admin' && updatedAlert.station_id === userData?.id && !updatedAlert.viewed_at) {
          socket.emit('alert_viewed', updatedAlert.id);
        }
        return newAlerts;
      });
    });

    socket.on('station_updated', (updatedStation: any) => {
      setStations(prev => prev.map(s => s.id === updatedStation.id ? { ...s, ...updatedStation } : s));
    });

    if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('new_alert');
      socket.off('alert_updated');
      socket.off('station_updated');
      socket.off('receive_message');
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

  const createStation = async (e: React.FormEvent) => {
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
      const res = await fetch('/api/stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        setIsAddingStation(false);
        fetchData();
      }
    } catch (err) { console.error("Error creating station", err); }
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
    // 1. Force station filtering if not admin
    if (user?.id !== 'admin' && a.station_id !== user?.id) return false;
    
    // 2. Apply UI filter (all, pending, dispatched)
    if (filter === 'all') return true;
    return a.status === filter;
  });

  return (
      <main className={styles.mapContainer}>
        <Map
          stations={stations}
          alerts={alerts}
          selectedAlert={selectedAlert}
          navigationActive={navigationActive}
          onRouteDataReady={(data) => { setEtaData(data); setSegmentProgress(0); }}
          onVehicleProgress={(seg) => setSegmentProgress(seg)}
        />
        
        {/* Floating Sidebar Overlay */}
        <aside className={styles.floatingPanel}>
          <header className={styles.panelHeader}>
            <div className={styles.stationBrand}>
              <span className={styles.logoMini}>SAU</span>
              <div className={styles.stationInfo}>
                <div className={styles.stationTitleRow}>
                  <span className={styles.stationName}>{user?.name}</span>
                  <div className={`${styles.systemStatus} ${isConnected ? styles.online : styles.offline}`}>
                    {isConnected ? 'TACTICAL-LINK: ACTIVE' : 'NO-SIGNAL'}
                  </div>
                </div>
                {user?.id !== 'admin' ? (
                  <div className={styles.statusPills}>
                    <button 
                      onClick={() => toggleStation(user.id, stationStatus)} 
                      className={`${styles.statusPill} ${stationStatus === 'available' ? styles.available : ''}`}
                    >
                      Disponible
                    </button>
                    <button 
                      onClick={() => toggleStation(user.id, stationStatus)} 
                      className={`${styles.statusPill} ${stationStatus === 'busy' ? styles.busy : ''}`}
                    >
                      En Intervention
                    </button>
                  </div>
                ) : (
                  <div className={styles.statusPills}>
                    <button className={styles.statusPill} onClick={() => setShowFleet(!showFleet)}>
                      {showFleet ? 'Voir Alertes' : 'Gérer Flotte'}
                    </button>
                    <button className={styles.statusPill} onClick={() => setIsAddingStation(true)}>
                      + Caserne
                    </button>
                    <button className={styles.btnTestAudio} onClick={playSiren}>
                      🔊 TEST ALARME
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button onClick={handleLogout} className={styles.btnLogoutIcon}>🚪</button>
          </header>

          <div className={styles.panelScroll}>
            {!showFleet ? (
              <>
                <div className={styles.filterTabs}>
                  <button className={filter === 'all' ? styles.activeTab : ''} onClick={() => setFilter('all')}>Tout</button>
                  <button className={filter === 'pending' ? styles.activeTab : ''} onClick={() => setFilter('pending')}>Attente</button>
                  <button className={filter === 'dispatched' ? styles.activeTab : ''} onClick={() => setFilter('dispatched')}>En Route</button>
                </div>

                {filteredAlerts.length === 0 && <p className={styles.noAlerts}>Aucune alerte trouvée.</p>}

                {filteredAlerts.map((a) => (
                  <div 
                    key={a.id} 
                    className={`${styles.tacticalCard} ${a.status === 'pending' ? styles.dangerPulse : ''} ${selectedAlert?.id === a.id ? styles.tacticalSelected : ''}`}
                    onClick={() => {
                      setSelectedAlert(a);
                      if (user?.id !== 'admin' && !a.viewed_at) {
                        socketRef.current?.emit('alert_viewed', a.id);
                      }
                    }}
                  >
                    <div className={styles.cardHeader}>
                      <span className={`${styles.typeBadge} ${styles[a.type]}`}>{a.type.toUpperCase()}</span>
                      <div className={styles.headerRight}>
                        {user?.id === 'admin' && a.viewed_at && (
                          <span className={styles.viewedBadge} title={`Lu par l'unité à ${new Date(a.viewed_at).toLocaleTimeString()}`}>👁️ VU</span>
                        )}
                        <span className={styles.timeLabel}>{new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    {user?.id === 'admin' && a.status === 'pending' && (
                      <div className={styles.assignSelection}>
                        <label>Assigner à:</label>
                        <select 
                          className={styles.assignSelect}
                          value={a.station_id || ''}
                          onClick={e => e.stopPropagation()}
                          onChange={(e) => updateAlertStation(a.id, e.target.value)}
                        >
                          <option value="">-- Sélect. Caserne --</option>
                          {stations.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className={styles.cardBody}>
                      {a.photo_url && (
                        <div className={styles.cardPhotoThumb}>
                          <img src={a.photo_url} alt="Alerte" onClick={(e) => { e.stopPropagation(); setSelectedAlert(a); }} />
                        </div>
                      )}
                      <div className={styles.cardInfoCol}>
                        <div className={styles.callerInfo}>
                          <strong>{a.name || 'Anonyme'}</strong>
                          <a href={`tel:${a.phone}`} onClick={e => e.stopPropagation()}>{a.phone}</a>
                        </div>
                        <div className={styles.locationSmall}>{a.station_id ? stations.find(s => s.id === a.station_id)?.name : 'Non assigné'}</div>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      {a.status === 'pending' && user?.id !== 'admin' && (
                        <button onClick={(e) => { e.stopPropagation(); updateAlertStatus(a.id, 'dispatched'); }} className={styles.btnActionPrimary}>PRENDRE EN CHARGE</button>
                      )}
                      {a.status === 'dispatched' && user?.id !== 'admin' && !navigationActive && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startMission(a); }}
                          className={styles.btnNavStart}
                        >
                          🚒 DÉMARRER L'INTERVENTION
                        </button>
                      )}
                      {a.status === 'dispatched' && user?.id !== 'admin' && (
                        <button onClick={(e) => { e.stopPropagation(); updateAlertStatus(a.id, 'resolved'); }} className={styles.btnActionSuccess}>TERMINER MISSION</button>
                      )}
                      <button className={styles.btnActionSecondary} onClick={(e) => { e.stopPropagation(); setSelectedAlert(a); }}>VOIR</button>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className={styles.fleetView}>
                <h3 className={styles.fleetTitle}>Flotte Opérationnelle ({stations.length})</h3>
                {stations.map(s => (
                  <div key={s.id} className={styles.fleetCardSmall}>
                    <div className={styles.fleetInfo}>
                      <strong>{s.name}</strong>
                      <span>{s.city}</span>
                    </div>
                    <span className={`${styles.fleetStatus} ${styles[s.status || 'active']}`}>
                      {s.status === 'inactive' ? 'HORS SERVICE' : 'PRÊT'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* INTERVENTION REPORT MODAL */}
        {reportingAlert && (
          <div className={styles.emergencyModal}>
            <div className={styles.reportCard}>
              <div className={styles.reportHeader}>
                <h1>RAPPORT DE FIN D'INTERVENTION</h1>
                <p>Mission: {reportingAlert.type.toUpperCase()} - {reportingAlert.name}</p>
              </div>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const report = {
                    victims: fd.get('victims'),
                    actions: fd.get('actions'),
                    site_status: fd.get('site_status'),
                    conclusion: fd.get('conclusion')
                  };
                  updateAlertStatus(reportingAlert.id, 'resolved', report);
                }}
                className={styles.reportForm}
              >
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Nombre de Victimes</label>
                    <input name="victims" type="number" defaultValue="0" required />
                  </div>
                  <div className={styles.formGroup}>
                    <label>État du site</label>
                    <select name="site_status" required>
                      <option value="secured">Sécurisé</option>
                      <option value="risk">Zone à risques</option>
                      <option value="cleared">Dégagé</option>
                    </select>
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>Actions principales menées</label>
                  <input name="actions" type="text" placeholder="ex: Extinction, Premiers secours..." required />
                </div>
                <div className={styles.formGroup}>
                  <label>Conclusion / Détails</label>
                  <textarea name="conclusion" placeholder="Observations finales de l'equipe..." required />
                </div>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnSubmitReport}>VALIDER ET CLÔTURER</button>
                  <button type="button" onClick={() => setReportingAlert(null)} className={styles.btnCancelReport}>Retour</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* STATION CREATION MODAL */}
        {isAddingStation && (
          <div className={styles.emergencyModal}>
            <div className={styles.adminCard}>
              <h2>AJOUTER UNE NOUVELLE CASERNE</h2>
              <form onSubmit={createStation} className={styles.adminForm}>
                <div className={styles.formGroup}>
                  <label>Nom de la Caserne</label>
                  <input name="name" type="text" placeholder="ex: GSPM Bingerville" required />
                </div>
                <div className={styles.formGroup}>
                  <label>Ville / Quartier</label>
                  <input name="city" type="text" placeholder="ex: Abidjan" required />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Latitude</label>
                    <input name="lat" type="number" step="0.000001" placeholder="5.33..." required />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Longitude</label>
                    <input name="lng" type="number" step="0.000001" placeholder="-4.02..." required />
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnSaveAdmin}>CRÉER L'UNITÉ</button>
                  <button type="button" onClick={() => setIsAddingStation(false)} className={styles.btnCancelAdmin}>Annuler</button>
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
                <p>Provenance: {newAlertPopup.name || 'Position détectée'}</p>
                <div className={styles.emergencyLocation}>Abidjan, Côte d'Ivoire</div>
              </div>
              <div className={styles.emergencyActions}>
                <button 
                  className={styles.btnAccept} 
                  onClick={() => {
                    updateAlertStatus(newAlertPopup.id, 'dispatched');
                    setSelectedAlert(newAlertPopup);
                    setNewAlertPopup(null);
                  }}
                >
                  ACCEPTER IMMÉDIATEMENT
                </button>
                <button className={styles.btnIgnore} onClick={() => setNewAlertPopup(null)}>Ignorer</button>
              </div>
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

      </main>
  );
}

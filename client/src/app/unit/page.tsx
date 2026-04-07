'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

// New Tactical Components
import { UnitHeader } from './components/UnitHeader';
import { MissionBriefing } from './components/MissionBriefing';
import { TacticalNav } from './components/TacticalNav';
import { ReportModal } from './components/ReportModal';

const UnitMap = dynamic(() => import('../../components/Map'), { ssr: false });

const DEFAULT_CENTER: [number, number] = [5.3365, -4.0268];

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function UnitInterface() {
  // ─── States ──────────────────────────────────────────────────────────────────
  const [unitId, setUnitId] = useState('');
  const [unit, setUnit] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [mission, setMission] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const [gpsPos, setGpsPos] = useState<[number, number] | null>(null);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [serverWaking, setServerWaking] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // ─── Refs ────────────────────────────────────────────────────────────────────
  const gpsLockedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeLockRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);

  // ─── Utilities ───────────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 4000) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (e) { console.warn('[SAU] Wake Lock failed', e); }
    }
  }, []);

  const playSiren = useCallback(() => {
    if (!audioCtxRef.current) return;
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
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.5);
        count++; if (count >= 20) clearInterval(interval);
      }, 500);
    } catch (e) { console.error('Audio error', e); }
  }, []);

  // ─── Auth / Login ────────────────────────────────────────────────────────────
  const loginUnit = async () => {
    if (!unitId || loading) return;
    setLoading(true);
    setServerWaking(false);

    const attemptLogin = async (attempt: number): Promise<boolean> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stationId: unitId }),
          signal: AbortSignal.timeout(12000),
        });
        const data = await res.json();
        if (data.success && data.isUnit) {
          setUnit(data.station);
          localStorage.setItem('sau_unit', JSON.stringify(data.station));
          if (data.currentMission) {
            setMission(data.currentMission);
            localStorage.setItem('sau_unit_mission', JSON.stringify(data.currentMission));
          }
          initSocket(data.station.id);
          requestWakeLock();
          return true;
        }
        showToast('❌ IDENTIFIANT UNITÉ INVALIDE', 'error');
        return false;
      } catch (e) {
        if (attempt < 3) {
          setRetryCount(attempt);
          if (attempt === 1) setServerWaking(true);
          await new Promise(r => setTimeout(r, 3000 * attempt));
          return attemptLogin(attempt + 1);
        }
        showToast('🔴 SERVEUR INJOIGNABLE', 'error');
        return false;
      }
    };

    await attemptLogin(1);
    setLoading(false);
    setServerWaking(false);
  };

  // ─── Socket Logic ────────────────────────────────────────────────────────────
  const initSocket = useCallback((id: string) => {
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    if (socketRef.current) socketRef.current.disconnect();
    
    const s = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
    });
    
    socketRef.current = s;
    setSocket(s);
    s.emit('join_room', id);

    s.on('connect', () => { 
      setSocketConnected(true); 
      s.emit('join_room', id);
      showToast('📡 LIAISON OK', 'success', 2000); 
    });
    s.on('disconnect', () => { setSocketConnected(false); showToast('⚠️ LIAISON PERDUE', 'warning'); });
    s.on('mission_received', (alert: any) => {
      setMission(alert);
      localStorage.setItem('sau_unit_mission', JSON.stringify(alert));
      playSiren();
      showToast('🚨 MISSION REÇUE !', 'error', 10000);
    });
    s.on('unit_updated', (updated: any) => {
      if (updated.id === id) setUnit((prev: any) => ({ ...prev, status: updated.status }));
    });
  }, [playSiren, showToast]);

  // ─── Initial Recovery ────────────────────────────────────────────────────────
  useEffect(() => {
    const session = localStorage.getItem('sau_unit');
    const savedMission = localStorage.getItem('sau_unit_mission');
    if (savedMission) { try { setMission(JSON.parse(savedMission)); } catch (e) {} }

    if (session) {
      try {
        const unitData = JSON.parse(session);
        setUnitId(unitData.id);
        setLoading(true);
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stationId: unitData.id }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.success && data.isUnit) {
              setUnit(data.station);
              if (data.currentMission) {
                setMission(data.currentMission);
                localStorage.setItem('sau_unit_mission', JSON.stringify(data.currentMission));
              } else if (unitData.status === 'available') {
                setMission(null);
                localStorage.removeItem('sau_unit_mission');
              }
              initSocket(data.station.id);
              requestWakeLock();
            }
          })
          .catch(() => showToast('⚠️ MODE HORS-LIGNE ACTIVÉ', 'warning'))
          .finally(() => setLoading(false));
      } catch (e) { setLoading(false); }
    }
  }, [initSocket, requestWakeLock, showToast]);

  // ─── GPS Tracking ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!unit || !socket) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!gpsLockedRef.current) {
          gpsLockedRef.current = true;
          setGpsLocked(true);
          showToast('📍 GPS VERROUILLÉ', 'success', 2000);
        }
        setGpsPos([lat, lng]);
        socket.emit('update_unit_position', { unitId: unit.id, lat, lng });
      },
      (err) => { if (!gpsLockedRef.current) setGpsPos(DEFAULT_CENTER); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [unit?.id, socket, showToast]);

  // ─── Core Handlers ───────────────────────────────────────────────────────────
  const updateStatus = (status: string) => {
    if (socket && unit) {
      socket.emit('unit_status_update', { unitId: unit.id, status, alertId: mission?.id });
      setUnit({ ...unit, status });
      if (status === 'available') {
        setMission(null);
        localStorage.removeItem('sau_unit_mission');
        setRouteData(null);
        showToast('✅ UNITÉ DISPONIBLE', 'success');
      }
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const reportData = {
      actions: (form as any).actions.value,
      conclusion: (form as any).conclusion.value,
      victimes: (form as any).victimes.value,
      timestamp: new Date(),
    };
    try {
      const res = await fetch(`/api/alerts/${mission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', report: reportData }),
      });
      if (res.ok) { updateStatus('available'); setShowReport(false); }
    } catch (err) { showToast('❌ ERREUR TRANSMISSION BILAN', 'error'); }
  };

  const handleLogout = () => {
    localStorage.removeItem('sau_unit'); localStorage.removeItem('sau_unit_mission');
    if (socketRef.current) socketRef.current.disconnect();
    setUnit(null); setMission(null); setUnitId(''); setGpsPos(null);
  };

  const formattedArrival = () => {
    if (!routeData) return '--:--';
    const now = new Date();
    now.setMinutes(now.getMinutes() + Math.ceil(routeData.durationMin));
    return now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // UI RENDERING
  // ══════════════════════════════════════════════════════════════════════════════

  // 1. LOGIN VIEW
  if (!unit) {
    return (
      <div className={styles.unitContainer}>
        <div className={styles.loginContainer}>
          <div className={styles.loginCard}>
            <div className={styles.logo}>SAU</div>
            <div className={styles.logoPulse}></div>
            <h1 className={styles.loginTitle}>TERMINAL TACTIQUE</h1>
            <p className={styles.loginSub}>Identification force d'intervention</p>
            {serverWaking && (
              <div className={styles.serverWakeAlert}>
                <div className={styles.serverWakeSpinner}></div>
                <div>
                  <div className={styles.serverWakeTitle}>RECONNEXION SERVEUR...</div>
                  <div className={styles.serverWakeSubtitle}>Tentative {retryCount}/3</div>
                </div>
              </div>
            )}
            <input
              autoFocus
              type="text"
              placeholder="ID Unité (ex: u1)"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={styles.loginInput}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && loginUnit()}
            />
            <button className={styles.btnLogin} onClick={loginUnit} disabled={loading}>
              {loading ? (serverWaking ? 'RÉVEIL...' : 'AUTH...') : 'DÉPLOYER L\'UNITÉ'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. MAIN DASHBOARD
  return (
    <div className={styles.unitContainer}>
      {/* Toast System */}
      <div className={styles.toastContainer}>
        {toasts.map(t => (
          <div key={t.id} className={`${styles.toast} ${styles[`toast_${t.type}`]}`}>
            {t.message}
          </div>
        ))}
      </div>

      <UnitHeader 
        unit={unit} 
        socketConnected={socketConnected}
        isOnline={isOnline}
        syncing={syncing}
        audioEnabled={audioEnabled}
        onActivateAudio={() => {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          setAudioEnabled(true);
        }}
        onLogout={handleLogout}
        deferredPrompt={deferredPrompt}
        onInstall={() => {}}
      />

      {/* Navigation Overlay */}
      <TacticalNav 
        mission={mission}
        unitStatus={unit?.status}
        routeData={routeData}
        onUpdateStatus={updateStatus}
        onShowReport={() => setShowReport(true)}
        getFormattedArrival={formattedArrival}
      />

      {/* Map Area */}
      <main className={styles.mapArea}>
        {gpsPos ? (
          <UnitMap
            stations={[]}
            alerts={mission ? [mission] : []}
            units={[unit]}
            selfUnitId={unit.id}
            selectedAlert={mission}
            navigationActive={unit?.status === 'en_route'}
            onRouteDataReady={(d) => setRouteData(d)}
            center={gpsPos}
            isLiveUnitMode={true}
          />
        ) : (
          <div className={styles.gpsLoader}>
            <div className={styles.gpsSpinner}></div>
            <strong>LOCALISATION TACTIQUE...</strong>
          </div>
        )}
      </main>

      {/* Mission Assignment Card */}
      {mission && unit?.status === 'available' && (
        <MissionBriefing 
          mission={mission}
          routeData={routeData}
          onAccept={() => updateStatus('en_route')}
          onRefuse={() => { setMission(null); localStorage.removeItem('sau_unit_mission'); }}
          onViewPhoto={setViewingPhoto}
        />
      )}

      {/* Closing Modal */}
      {showReport && (
        <ReportModal 
          mission={mission}
          onSubmit={handleReportSubmit}
          onCancel={() => setShowReport(false)}
        />
      )}

      {/* Photo Viewer */}
      {viewingPhoto && (
        <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
          <div className={styles.photoViewerContent} onClick={(e) => e.stopPropagation()}>
             <img src={viewingPhoto} alt="Alerte" />
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import NextDynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

import { UnitHeader } from './components/UnitHeader';
import { MissionBriefing } from './components/MissionBriefing';
import { TacticalNav } from './components/TacticalNav';
import { ReportModal } from './components/ReportModal';

import type { MapProps } from '../../components/Map';

export const dynamic = 'force-dynamic';

const UnitMap = NextDynamic<any>(() => import('../../components/Map'), { ssr: false });

interface TacticalToast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function UnitTacticalPage() {
  const [tacticalUnit, setTacticalUnit] = useState<any>(null);
  const [activeMission, setActiveMission] = useState<any>(null);
  const [pendingAlert, setPendingAlert] = useState<any>(null);
  const [tacticalUnitId, setTacticalUnitId] = useState('');
  const [tacticalGpsPos, setTacticalGpsPos] = useState<[number, number] | null>(null);
  const [tacticalRouteInfo, setTacticalRouteInfo] = useState<any>(null);
  const [isTacticalAudioActive, setIsTacticalAudioActive] = useState(false);
  const [isTacticalShowingReport, setIsTacticalShowingReport] = useState(false);
  const [isTacticalOnlineStatus] = useState(true);
  const [isTacticalSyncing] = useState(false);
  const [isTacticalLoading, setIsTacticalLoading] = useState(false);
  const [isTacticalServerWaking, setIsTacticalServerWaking] = useState(false);
  const [tacticalToasts, setTacticalToasts] = useState<TacticalToast[]>([]);
  const [isTacticalSocketConnected, setIsTacticalSocketConnected] = useState(false);
  const [tacticalDeferredPrompt, setTacticalDeferredPrompt] = useState<any>(null);
  const [tacticalCurrentSpeed, setTacticalCurrentSpeed] = useState(0);
  const [tacticalGpsHeading, setTacticalGpsHeading] = useState(0);
  const [tacticalCompassHeading, setTacticalCompassHeading] = useState(0);
  const [viewingTacticalPhoto, setViewingTacticalPhoto] = useState<string | null>(null);

  const tacticalGpsWatchRef = useRef<number | null>(null);
  const tacticalAudioCtxRef = useRef<AudioContext | null>(null);
  const tacticalWakeLockRef = useRef<any>(null);
  const tacticalSocketRef = useRef<Socket | null>(null);
  const tacticalCompassRef = useRef(0);
  const isTacticalAudioActiveRef = useRef(false);

  // Sync ref avec state pour éviter les stale closures dans les listeners socket
  useEffect(() => {
    isTacticalAudioActiveRef.current = isTacticalAudioActive;
  }, [isTacticalAudioActive]);

  // ─── Toasts ──────────────────────────────────────────────────────────────────
  const showTacticalToast = useCallback((msg: string, type: TacticalToast['type'] = 'info', dur = 4000) => {
    const tid = `${Date.now()}_${Math.random()}`;
    setTacticalToasts(prev => [...prev, { id: tid, message: msg, type }]);
    setTimeout(() => setTacticalToasts(prev => prev.filter(t => t.id !== tid)), dur);
  }, []);

  // ─── Audio ───────────────────────────────────────────────────────────────────
  const playTacticalNavBeep = useCallback(() => {
    const ctx = tacticalAudioCtxRef.current;
    if (!ctx || !isTacticalAudioActiveRef.current) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (err) { console.error('[Audio] beep error', err); }
  }, []);

  const playTacticalSiren = useCallback((mode: 'mission' | 'approach' = 'mission') => {
    const ctx = tacticalAudioCtxRef.current;
    if (!ctx || !isTacticalAudioActiveRef.current) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const totalBeeps = mode === 'mission' ? 16 : 6;
      const freqLow = mode === 'mission' ? 600 : 800;
      const freqHigh = mode === 'mission' ? 900 : 1200;
      let count = 0;
      const interval = setInterval(() => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(count % 2 === 0 ? freqLow : freqHigh, now);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
        count++;
        if (count >= totalBeeps) clearInterval(interval);
      }, 500);
    } catch (err) { console.error('[Audio] siren error', err); }
  }, []);

  useEffect(() => {
    const handleNavEvent = () => playTacticalNavBeep();
    window.addEventListener('sau-nav-instruction', handleNavEvent);
    return () => window.removeEventListener('sau-nav-instruction', handleNavEvent);
  }, [playTacticalNavBeep]);

  // ─── Status ───────────────────────────────────────────────────────────────────
  const updateTacticalStatus = useCallback((status: string, explicitAlertId?: string) => {
    if (!tacticalSocketRef.current || !tacticalUnit) return;
    // explicitAlertId est nécessaire quand l'activeMission vient d'être settée (React state pas encore appliqué)
    const alertId = explicitAlertId ?? activeMission?.id;
    const payload: any = { unitId: tacticalUnit.id, status, alertId };
    if (status === 'en_route') payload.transit_at = new Date().toISOString();
    if (status === 'on_site') payload.on_site_at = new Date().toISOString();
    tacticalSocketRef.current.emit('unit_status_update', payload);
    setTacticalUnit((prev: any) => ({ ...prev, status }));
    if (status === 'available') {
      setActiveMission(null);
      setPendingAlert(null);
      localStorage.removeItem('sau_unit_mission');
      setTacticalRouteInfo(null);
      showTacticalToast('✅ UNITÉ DISPONIBLE', 'success');
    }
  }, [tacticalUnit, activeMission, showTacticalToast]);

  // ─── Socket ───────────────────────────────────────────────────────────────────
  const initTacticalSocket = useCallback((unitId: string) => {
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    if (tacticalSocketRef.current) tacticalSocketRef.current.disconnect();
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });
    tacticalSocketRef.current = socket;
    socket.emit('join_room', unitId);
    socket.on('connect', () => {
      setIsTacticalSocketConnected(true);
      socket.emit('join_room', unitId);
      showTacticalToast('📡 LIAISON OK', 'success', 2000);
    });
    socket.on('disconnect', () => {
      setIsTacticalSocketConnected(false);
      showTacticalToast('⚠️ LIAISON PERDUE — RECONNEXION...', 'warning');
    });
    socket.on('mission_received', (missionData: any) => {
      setPendingAlert(missionData);
      playTacticalSiren('mission');
      showTacticalToast('🚨 NOUVELLE MISSION REÇUE !', 'error', 10000);
      
      if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(`🚨 NOUVELLE MISSION SAU : ${missionData.type?.toUpperCase() || 'URGENCE'}`, {
            body: missionData.notes || 'Déploiement immédiat requis.',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            vibrate: [200, 100, 200, 100, 200],
            tag: 'sau-alert',
            requireInteraction: true,
            data: { url: '/unit' }
          });
        });
      } else if (Notification.permission === 'granted') {
        new Notification("🚨 NOUVELLE MISSION SAU", { body: missionData.type, icon: '/icons/icon-192x192.png' });
      }
    });
    socket.on('unit_updated', (updatedUnit: any) => {
      if (updatedUnit.id === unitId) {
        setTacticalUnit((prev: any) => ({ ...prev, status: updatedUnit.status }));
      }
    });
  }, [showTacticalToast, playTacticalSiren]);

  // ─── Wake Lock ────────────────────────────────────────────────────────────────
  const requestWakeLock = useCallback(async () => {
    if (typeof window === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      tacticalWakeLockRef.current = await (navigator as any).wakeLock.request('screen');
    } catch (err) { console.warn('[WakeLock] failed', err); }
  }, []);

  // ─── Auth ─────────────────────────────────────────────────────────────────────
  const attemptTacticalLogin = async (unitId: string) => {
    if (!unitId.trim()) return;
    try {
      setIsTacticalLoading(true);
      setIsTacticalServerWaking(true);
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: unitId }),
      });
      const data = await response.json();
      if (data.success && data.isUnit) {
        setTacticalUnit(data.station);
        localStorage.setItem('sau_unit', JSON.stringify(data.station));
        if (data.currentMission) {
          setActiveMission(data.currentMission);
          localStorage.setItem('sau_unit_mission', JSON.stringify(data.currentMission));
        }
        initTacticalSocket(data.station.id);
        requestWakeLock();
        showTacticalToast(`✅ CONNECTÉ : ${data.station.name}`, 'success');
      } else {
        showTacticalToast('❌ ID UNITÉ INVALIDE', 'error');
      }
    } catch (err) {
      showTacticalToast('⚠️ ERREUR RÉSEAU — RÉESSAYEZ', 'error');
    } finally {
      setIsTacticalLoading(false);
      setIsTacticalServerWaking(false);
    }
  };

  // ─── Session Recovery ─────────────────────────────────────────────────────────
  useEffect(() => {
    const savedSession = localStorage.getItem('sau_unit');
    if (!savedSession) return;
    try {
      const unitData = JSON.parse(savedSession);
      setIsTacticalLoading(true);
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: unitData.id }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.isUnit) {
            setTacticalUnit(data.station);
            if (data.currentMission) {
              setActiveMission(data.currentMission);
            } else {
              const savedMission = localStorage.getItem('sau_unit_mission');
              if (savedMission) setActiveMission(JSON.parse(savedMission));
            }
            initTacticalSocket(data.station.id);
            requestWakeLock();
          } else {
            localStorage.removeItem('sau_unit');
          }
        })
        .catch(() => showTacticalToast('⚠️ MODE HORS-LIGNE', 'warning'))
        .finally(() => setIsTacticalLoading(false));
    } catch {
      localStorage.removeItem('sau_unit');
    }
  }, [initTacticalSocket, requestWakeLock, showTacticalToast]);

  // ─── GPS ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tacticalUnit) return;
    if (tacticalGpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(tacticalGpsWatchRef.current);
    }
    tacticalGpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, heading, speed } = position.coords;
        setTacticalGpsPos([latitude, longitude]);
        setTacticalCurrentSpeed(speed || 0);
        if (heading !== null) setTacticalGpsHeading(heading);
        // Heartbeat GPS vers serveur
        tacticalSocketRef.current?.emit('unit_location_update', {
          id: tacticalUnit.id,
          lat: latitude,
          lng: longitude,
          heading: tacticalCompassRef.current || heading || 0,
          speed: speed || 0,
          status: tacticalUnit.status,
        });
      },
      (err) => console.warn('[GPS] Error', err.message),
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
    return () => {
      if (tacticalGpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(tacticalGpsWatchRef.current);
        tacticalGpsWatchRef.current = null;
      }
    };
  }, [tacticalUnit?.id]);

  // ─── Boussole ────────────────────────────────────────────────────────────────
  const triggerTacticalCompassActivation = useCallback(() => {
    if (typeof window === 'undefined') return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const iosHeading = (event as any).webkitCompassHeading;
      let degrees: number;
      if (iosHeading !== undefined && iosHeading !== null) {
        degrees = iosHeading;
      } else if (event.alpha !== null) {
        degrees = (360 - event.alpha) % 360;
      } else return;
      tacticalCompassRef.current = degrees;
      setTacticalCompassHeading(degrees);
    };
    const startListening = () => {
      window.addEventListener('deviceorientation', handleOrientation, true);
      showTacticalToast('🧭 Boussole activée', 'success', 2000);
    };
    const DevOrEvt = DeviceOrientationEvent as any;
    if (typeof DevOrEvt.requestPermission === 'function') {
      DevOrEvt.requestPermission()
        .then((result: string) => { if (result === 'granted') startListening(); })
        .catch(() => startListening());
    } else {
      startListening();
    }
  }, [showTacticalToast]);

  const handleFullTacticalActivation = useCallback(() => {
    if (!tacticalAudioCtxRef.current) {
      tacticalAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (tacticalAudioCtxRef.current.state === 'suspended') {
      tacticalAudioCtxRef.current.resume();
    }
    setIsTacticalAudioActive(true);
    triggerTacticalCompassActivation();
    showTacticalToast('🔊 SON TACTIQUE ACTIVÉ', 'success', 2000);
  }, [triggerTacticalCompassActivation, showTacticalToast]);

  // ─── PWA Install ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleInstallPrompt = (event: any) => {
      event.preventDefault();
      setTacticalDeferredPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  const handleTacticalInstall = async () => {
    if (!tacticalDeferredPrompt) return;
    tacticalDeferredPrompt.prompt();
    const { outcome } = await tacticalDeferredPrompt.userChoice;
    if (outcome === 'accepted') setTacticalDeferredPrompt(null);
  };

  // ─── Logout ───────────────────────────────────────────────────────────────────
  const handleTacticalLogout = () => {
    localStorage.removeItem('sau_unit');
    localStorage.removeItem('sau_unit_mission');
    tacticalSocketRef.current?.disconnect();
    if (tacticalGpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(tacticalGpsWatchRef.current);
      tacticalGpsWatchRef.current = null;
    }
    setTacticalUnit(null);
    setActiveMission(null);
    setPendingAlert(null);
    setTacticalUnitId('');
    setTacticalGpsPos(null);
    setTacticalRouteInfo(null);
  };

  // ─── Report ───────────────────────────────────────────────────────────────────
  const handleReportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const reportPayload = {
      actions: (form as any).actions?.value,
      conclusion: (form as any).conclusion?.value,
      victimes: (form as any).victimes?.value,
      timestamp: new Date().toISOString(),
    };
    try {
      showTacticalToast('⏳ Transmission en cours...', 'info');
      const response = await fetch(`/api/alerts/${activeMission?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', report: reportPayload, resolved_at: new Date().toISOString() }),
      });
      if (response.ok) {
        updateTacticalStatus('available');
        setIsTacticalShowingReport(false);
        showTacticalToast('✅ BILAN TRANSMIS', 'success');
      } else {
        showTacticalToast('❌ ERREUR DE TRANSMISSION', 'error');
      }
    } catch {
      updateTacticalStatus('available');
      setIsTacticalShowingReport(false);
    }
  };

  // ─── LOGIN VIEW ───────────────────────────────────────────────────────────────
  if (!tacticalUnit) {
    return (
      <div className={styles.unitContainer}>
        {/* Toasts visibles même sur l'écran de login */}
        <div className={styles.toastContainer}>
          {tacticalToasts.map(toast => (
            <div key={toast.id} className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
              {toast.message}
            </div>
          ))}
        </div>
        <div className={styles.loginContainer}>
          <div className={styles.loginCard}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <div className={styles.logo}>SAU</div>
              <div className={styles.logoPulse} />
            </div>
            <h1 className={styles.loginTitle}>TERMINAL TACTIQUE</h1>
            <p className={styles.loginSub}>Identification force d&apos;intervention</p>
            {isTacticalServerWaking && (
              <div className={styles.serverWakeAlert}>
                <div className={styles.serverWakeSpinner} />
                <div>
                  <div className={styles.serverWakeTitle}>CONNEXION AU SERVEUR...</div>
                  <div className={styles.serverWakeSubtitle}>Veuillez patienter</div>
                </div>
              </div>
            )}
            <input
              autoFocus
              type="text"
              placeholder="ID Unité (ex: u1)"
              className={styles.loginInput}
              value={tacticalUnitId}
              onChange={e => setTacticalUnitId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && attemptTacticalLogin(tacticalUnitId)}
              disabled={isTacticalLoading}
            />
            <button
              className={styles.combatBtnXxl}
              style={{
                marginTop: 20,
                backgroundColor: '#3b82f6',
                color: '#fff',
                opacity: isTacticalLoading ? 0.6 : 1,
              }}
              onClick={() => attemptTacticalLogin(tacticalUnitId)}
              disabled={isTacticalLoading}
            >
              {isTacticalLoading ? '⏳ CONNEXION...' : '🔐 SE CONNECTER'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN TACTICAL VIEW ───────────────────────────────────────────────────────
  return (
    <div className={styles.unitContainer}>
      {/* Toasts */}
      <div className={styles.toastContainer}>
        {tacticalToasts.map(toast => (
          <div key={toast.id} className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
            {toast.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <UnitHeader
        unit={tacticalUnit}
        socketConnected={isTacticalSocketConnected}
        isOnline={isTacticalOnlineStatus}
        syncing={isTacticalSyncing}
        audioEnabled={isTacticalAudioActive}
        onActivateAudio={handleFullTacticalActivation}
        onLogout={handleTacticalLogout}
        deferredPrompt={tacticalDeferredPrompt}
        onInstall={handleTacticalInstall}
      />

      {/* Navigation Overlay (TacticalNav) — visible seulement en mission */}
      <TacticalNav
        mission={activeMission}
        unitStatus={tacticalUnit.status}
        routeData={tacticalRouteInfo}
        onUpdateStatus={updateTacticalStatus}
        onShowReport={() => setIsTacticalShowingReport(true)}
        getFormattedArrival={() => {
          if (!tacticalRouteInfo) return '--:--';
          const arrival = new Date();
          arrival.setMinutes(arrival.getMinutes() + Math.ceil(tacticalRouteInfo.durationMin));
          return arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        }}
      />

      {/* Carte principale */}
      <main className={styles.mapArea}>
        {tacticalGpsPos ? (
          <UnitMap
            center={tacticalGpsPos}
            alerts={activeMission ? [activeMission] : []}
            units={[tacticalUnit]}
            navigationActive={tacticalUnit.status === 'en_route'}
            selectedAlert={activeMission}
            speed={tacticalCurrentSpeed}
            heading={tacticalCompassHeading || tacticalGpsHeading}
            onRouteDataReady={setTacticalRouteInfo}
          />
        ) : (
          <div className={styles.gpsLoader}>
            <div className={styles.gpsSpinner} />
            <strong>LOCALISATION GPS EN COURS...</strong>
            <span style={{ color: '#64748b', fontSize: 13 }}>Autorisez la géolocalisation</span>
          </div>
        )}
      </main>

      {/* Fiche de mission en attente */}
      {pendingAlert && (
        <MissionBriefing
          mission={pendingAlert}
          routeData={tacticalRouteInfo}
          onAccept={() => {
            // On capture l'alerte AVANT de la supprimer du state pending
            const missionToStart = pendingAlert;
            setActiveMission(missionToStart);
            localStorage.setItem('sau_unit_mission', JSON.stringify(missionToStart));
            setPendingAlert(null);
            // Passage EXPLICITE de l'alertId pour éviter la stale closure sur activeMission
            updateTacticalStatus('en_route', missionToStart?.id);
            playTacticalSiren('approach');
            showTacticalToast('🚀 MISSION ACCEPTÉE — EN ROUTE !', 'success');
          }}
          onRefuse={() => {
            setPendingAlert(null);
            showTacticalToast('Mission déclinée', 'warning');
          }}
          onViewPhoto={(photoUrl: string) => setViewingTacticalPhoto(photoUrl)}
        />
      )}

      {/* Modal rapport de clôture */}
      {isTacticalShowingReport && (
        <ReportModal
          mission={activeMission}
          onSubmit={handleReportSubmit}
          onCancel={() => setIsTacticalShowingReport(false)}
        />
      )}

      {/* Viewer photo plein écran */}
      {viewingTacticalPhoto && (
        <div
          className={styles.photoViewerOverlay}
          onClick={() => setViewingTacticalPhoto(null)}
        >
          <div className={styles.photoViewerContent}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewingTacticalPhoto} alt="Photo de l'incident" />
            <button
              onClick={() => setViewingTacticalPhoto(null)}
              style={{
                marginTop: 20,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                padding: '12px 32px',
                borderRadius: 99,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✕ FERMER
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

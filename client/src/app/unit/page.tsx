'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import NextDynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

// Tactical Components
import { UnitHeader } from './components/UnitHeader';
import { MissionBriefing } from './components/MissionBriefing';
import { TacticalNav } from './components/TacticalNav';
import { ReportModal } from './components/ReportModal';

import type { MapProps } from '../../components/Map';

export const dynamic = 'force-dynamic';

const UnitMap = NextDynamic<any>(() => import('../../components/Map'), { ssr: false });

const DEFAULT_TACTICAL_CENTER: [number, number] = [5.3365, -4.0268];

interface TacticalToast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function UnitTacticalPage() {
  // ─── States (Verbose Names) ──────────────────────────────────────────────────
  const [tacticalUnit, setTacticalUnit] = useState<any>(null);
  const [activeMission, setActiveMission] = useState<any>(null);
  const [pendingAlert, setPendingAlert] = useState<any>(null);
  const [tacticalUnitId, setTacticalUnitId] = useState('');
  const [tacticalGpsPos, setTacticalGpsPos] = useState<[number, number] | null>(null);
  const [isTacticalGpsLocked, setIsTacticalGpsLocked] = useState(false);
  const [tacticalRouteInfo, setTacticalRouteInfo] = useState<any>(null);
  const [isTacticalAudioActive, setIsTacticalAudioActive] = useState(false);
  const [isTacticalShowingReport, setIsTacticalShowingReport] = useState(false);
  const [isTacticalOnlineStatus, setIsTacticalOnlineStatus] = useState(true);
  const [isTacticalSyncing, setIsTacticalSyncing] = useState(false);
  const [isTacticalLoading, setIsTacticalLoading] = useState(false);
  const [tacticalRetryCounter, setTacticalRetryCounter] = useState(0);
  const [isTacticalServerWaking, setIsTacticalServerWaking] = useState(false);
  const [tacticalToasts, setTacticalToasts] = useState<TacticalToast[]>([]);
  const [isTacticalSocketConnected, setIsTacticalSocketConnected] = useState(false);
  const [tacticalDeferredPrompt, setTacticalDeferredPrompt] = useState<any>(null);
  const [tacticalCurrentSpeed, setTacticalCurrentSpeed] = useState(0);
  const [tacticalGpsHeading, setTacticalGpsHeading] = useState(0);
  const [tacticalCompassHeading, setTacticalCompassHeading] = useState(0);
  const [viewingTacticalPhoto, setViewingTacticalPhoto] = useState<string | null>(null);

  // ─── Refs ────────────────────────────────────────────────────────────────────
  const tacticalGpsLockedRef = useRef(false);
  const tacticalAudioCtxRef = useRef<AudioContext | null>(null);
  const tacticalWakeLockRef = useRef<any>(null);
  const tacticalSocketRef = useRef<Socket | null>(null);
  const tacticalCompassRef = useRef(0);

  // ─── Core Logic ──────────────────────────────────────────────────────────────
  const showTacticalToast = useCallback((msg: string, type: TacticalToast['type'] = 'info', dur = 4000) => {
    const tid = Date.now().toString();
    setTacticalToasts(p => [...p, { id: tid, message: msg, type }]);
    setTimeout(() => setTacticalToasts(p => p.filter(t => t.id !== tid)), dur);
  }, []);

  const playTacticalNavBeep = useCallback(() => {
    if (!tacticalAudioCtxRef.current || !isTacticalAudioActive) return;
    try {
      const ctx = tacticalAudioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.05);
      g.gain.linearRampToValueAtTime(0, t + 0.2);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.2);
    } catch (e) { console.error('Audio Error', e); }
  }, [isTacticalAudioActive]);

  const playTacticalSiren = useCallback((mode: 'mission' | 'approach' = 'mission') => {
    if (!tacticalAudioCtxRef.current || !isTacticalAudioActive) return;
    try {
      const ctx = tacticalAudioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const dur = mode === 'mission' ? 8 : 3;
      const freq = mode === 'mission' ? [600, 900] : [800, 1200];
      let c = 0;
      const iter = setInterval(() => {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(c % 2 === 0 ? freq[0] : freq[1], t);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.5);
        c++;
        if (c >= dur * 2) clearInterval(iter);
      }, 500);
    } catch (e) { console.error('Siren Error', e); }
  }, [isTacticalAudioActive]);

  useEffect(() => {
    const h = () => { if (isTacticalAudioActive) playTacticalNavBeep(); };
    window.addEventListener('sau-nav-instruction', h);
    return () => window.removeEventListener('sau-nav-instruction', h);
  }, [isTacticalAudioActive, playTacticalNavBeep]);

  // ─── Status Updates ──────────────────────────────────────────────────────────
  const updateTacticalStatus = (status: string) => {
    if (tacticalSocketRef.current && tacticalUnit) {
      const p: any = { unitId: tacticalUnit.id, status, alertId: activeMission?.id };
      if (status === 'en_route') p.transit_at = new Date().toISOString();
      if (status === 'on_site') p.on_site_at = new Date().toISOString();
      tacticalSocketRef.current.emit('unit_status_update', p);
      setTacticalUnit({ ...tacticalUnit, status });
      if (status === 'available') {
        setActiveMission(null);
        localStorage.removeItem('sau_unit_mission');
        setTacticalRouteInfo(null);
        showTacticalToast('✅ UNITÉ DISPONIBLE', 'success');
      }
    }
  };

  // ─── Install Logic ───────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: any) => {
      e.preventDefault();
      setTacticalDeferredPrompt(e);
      showTacticalToast('📥 APPLICATION DISPONIBLE', 'info', 5000);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, [showTacticalToast]);

  const handleTacticalInstall = async () => {
    if (!tacticalDeferredPrompt) return;
    tacticalDeferredPrompt.prompt();
    const { outcome } = await tacticalDeferredPrompt.userChoice;
    if (outcome === 'accepted') setTacticalDeferredPrompt(null);
  };

  // ─── Auth ─────────────────────────────────────────────────────────────────────
  const attemptTacticalLogin = async (id: string) => {
    try {
      setIsTacticalLoading(true);
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: id }),
      });
      const d = await r.json();
      if (d.success && d.isUnit) {
        setTacticalUnit(d.station);
        if (d.currentMission) setActiveMission(d.currentMission);
        localStorage.setItem('sau_unit', JSON.stringify(d.station));
        initTacticalSocket(d.station.id);
        return true;
      }
      return false;
    } catch (e) { return false; } finally { setIsTacticalLoading(false); }
  };

  const initTacticalSocket = (id: string) => {
    const url = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    if (tacticalSocketRef.current) tacticalSocketRef.current.disconnect();
    const s = io(url, { transports: ['websocket', 'polling'] });
    tacticalSocketRef.current = s;
    s.emit('join_room', id);
    s.on('connect', () => setIsTacticalSocketConnected(true));
    s.on('disconnect', () => setIsTacticalSocketConnected(false));
    s.on('mission_received', (m: any) => {
      setPendingAlert(m);
      if (isTacticalAudioActive) playTacticalSiren('mission');
      showTacticalToast('🚨 NOUVELLE MISSION DÉTECTÉE !', 'error', 10000);
    });
    s.on('unit_updated', (u: any) => {
      if (u.id === id) setTacticalUnit((p: any) => ({ ...p, status: u.status }));
    });
  };

  const handleTacticalLogout = () => {
    localStorage.removeItem('sau_unit'); localStorage.removeItem('sau_unit_mission');
    tacticalSocketRef.current?.disconnect();
    setTacticalUnit(null); setActiveMission(null); setTacticalUnitId(''); setTacticalGpsPos(null);
  };

  // ─── Compass ──────────────────────────────────────────────────────────────────
  const triggerTacticalCompassActivation = useCallback(() => {
    if (typeof window === 'undefined') return;
    const h = (e: DeviceOrientationEvent) => {
      const hI = (e as any).webkitCompassHeading;
      let d: number;
      if (hI !== undefined && hI !== null) d = hI;
      else if (e.alpha !== null) d = (360 - e.alpha) % 360;
      else return;
      tacticalCompassRef.current = d;
      setTacticalCompassHeading(d);
    };
    const start = () => {
      window.addEventListener('deviceorientation', h, true);
      showTacticalToast('🧭 Boussole calibrée', 'success', 2000);
    };
    const DOE = (DeviceOrientationEvent as any);
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission().then((s: string) => { if (s === 'granted') start(); });
    } else start();
  }, [showTacticalToast]);

  const handleFullTacticalActivation = useCallback(() => {
     if (!tacticalAudioCtxRef.current) {
       tacticalAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
     }
     if (tacticalAudioCtxRef.current.state === 'suspended') tacticalAudioCtxRef.current.resume();
     setIsTacticalAudioActive(true);
     triggerTacticalCompassActivation();
  }, [triggerTacticalCompassActivation]);

  // ─── GPS Tracking ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tacticalUnit || !tacticalSocketRef.current) return;
    const wId = navigator.geolocation.watchPosition((p) => {
      const lat = p.coords.latitude, lng = p.coords.longitude;
      setTacticalGpsPos([lat, lng]);
      setTacticalCurrentSpeed(p.coords.speed || 0);
      if (p.coords.heading !== null) setTacticalGpsHeading(p.coords.heading);
      if (!tacticalGpsLockedRef.current) { tacticalGpsLockedRef.current = true; setIsTacticalGpsLocked(true); }
      
      // Heartbeat
      tacticalSocketRef.current?.emit('unit_location_update', {
        id: tacticalUnit.id, lat, lng,
        heading: tacticalCompassRef.current || p.coords.heading || 0,
        speed: p.coords.speed || 0,
        status: tacticalUnit.status
      });
    }, null, { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(wId);
  }, [tacticalUnit]);

  // ─── Rendering ────────────────────────────────────────────────────────────────
  if (!tacticalUnit) {
    return (
      <div className={styles.unitContainer}>
          <div className={styles.loginContainer}>
             <div className={styles.loginCard}>
                <div className={styles.logo}>SAU</div>
                <h1 className={styles.loginTitle}>TERMINAL TACTIQUE</h1>
                <input 
                  type="text" 
                  autoFocus 
                  placeholder="ID Unité" 
                  className={styles.loginInput}
                  value={tacticalUnitId} 
                  onChange={e => setTacticalUnitId(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && attemptTacticalLogin(tacticalUnitId)}
                />
                <button 
                  className={styles.combatBtnXxl} 
                  style={{marginTop: 20}}
                  onClick={() => attemptTacticalLogin(tacticalUnitId)}
                >
                  CONNECTION
                </button>
             </div>
          </div>
      </div>
    );
  }

  return (
    <div className={styles.unitContainer}>
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

      <TacticalNav 
        mission={activeMission}
        unitStatus={tacticalUnit.status}
        routeData={tacticalRouteInfo}
        onUpdateStatus={updateTacticalStatus}
        onShowReport={() => setIsTacticalShowingReport(true)}
        getFormattedArrival={() => 'N/A'}
      />

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
          <div className={styles.gpsLoader}>LOCALISATION...</div>
        )}
      </main>

      {pendingAlert && (
          <MissionBriefing 
            mission={pendingAlert}
            routeData={tacticalRouteInfo}
            onAccept={() => { setActiveMission(pendingAlert); setPendingAlert(null); updateTacticalStatus('en_route'); }}
            onRefuse={() => setPendingAlert(null)}
            onViewPhoto={p => setViewingTacticalPhoto(p)}
          />
      )}

      {isTacticalShowingReport && (
          <ReportModal 
            mission={activeMission}
            onSubmit={(e:any) => { e.preventDefault(); updateTacticalStatus('available'); setIsTacticalShowingReport(false); }}
            onCancel={() => setIsTacticalShowingReport(false)}
          />
      )}
    </div>
  );
}

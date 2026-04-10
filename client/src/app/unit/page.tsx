'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

import { UnitHeader } from './components/UnitHeader';
import { MissionBriefing } from './components/MissionBriefing';
import { TacticalNav } from './components/TacticalNav';
import { ReportModal } from './components/ReportModal';
import { TacticalMapEngine } from './components/TacticalMapEngine';

import { useTacticalGPS } from './hooks/useTacticalGPS';
import { useTacticalSync } from './hooks/useTacticalSync';

export const dynamic = 'force-dynamic';

export default function UnitTacticalPage() {
  // ─── STATE ─────────────────────────────────────────────────────────────────
  const [unit, setUnit] = useState<any>(null);
  const [activeMission, setActiveMission] = useState<any>(null);
  const [pendingMission, setPendingMission] = useState<any>(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [guidance, setGuidance] = useState({ text: '', distance: 0 });
  const [isReporting, setIsReporting] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  
  const [socket, setSocket] = useState<Socket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Custom Hooks
  const { position, heading, speed } = useTacticalGPS();
  // Status computed: if unit is null -> logging in
  const currentStatus = unit?.status || 'offline';
  
  useTacticalSync(unit?.id, currentStatus, position, heading, speed, socket);

  // ─── SELF-HEALING LOGIC ────────────────────────────────────────────────────
  // If unit is in a deployed state but has no mission object, reset to available
  useEffect(() => {
    if (unit && currentStatus !== 'available' && !activeMission && !pendingMission) {
      console.warn('[SAU] State desync detected: Deployed status without mission. Resetting...');
      changeStatus('available');
    }
  }, [currentStatus, activeMission, pendingMission, unit]);

  // ─── INITIALIZATION (Auth & Socket) ────────────────────────────────────────
  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });

    const saved = localStorage.getItem('sau_unit');
    if (saved) {
      try {
        const parsedNode = JSON.parse(saved);
        loginUnit(parsedNode.id);
      } catch (e) { localStorage.removeItem('sau_unit'); }
    }
  }, []);

  const [loginError, setLoginError] = useState('');

  const loginUnit = async (stationId: string) => {
    try {
      setLoginError('');
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stationId: stationId.trim() }) });
      const data = await res.json();
      if (data.success && data.isUnit) {
        setUnit(data.station);
        localStorage.setItem('sau_unit', JSON.stringify(data.station));
        if (data.currentMission) {
          setActiveMission(data.currentMission);
        } else {
          setActiveMission(JSON.parse(localStorage.getItem('sau_unit_mission') || 'null'));
        }
        initSocket(data.station.id);
      } else {
        setLoginError(data.error || 'ID Tactique invalide.');
      }
    } catch (e) {
      setLoginError('Serveur injoignable (Réseau ou Hors-ligne)');
    }
  };

  const initSocket = (uid: string) => {
    const s = io(process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008', { transports: ['websocket', 'polling'] });
    setSocket(s);
    
    s.on('connect', () => s.emit('join_room', uid));
    
    s.on('mission_received', (mission) => {
      setPendingMission(mission);
      playSiren();
      // Push Web
      if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(`🚨 NOUVELLE MISSION : ${mission.type}`, { body: mission.notes || 'Déploiement immédiat', icon: '/icons/icon-192x192.png', vibrate: [200, 100, 200] });
        });
      }
    });

    s.on('unit_updated', (u: any) => {
      if (u.id === uid) {
        setUnit((prev: any) => ({ ...prev, status: u.status }));
        if (u.status === 'available') {
          setActiveMission((prev: any) => {
            if (prev) alert('MISSION ANNULÉE PAR LE QUARTIER GÉNÉRAL.');
            return null;
          });
          localStorage.removeItem('sau_unit_mission');
        }
      }
    });
  };

  // ─── AUDIO SYSTEM ────────────────────────────────────────────────────────
  const initAudio = () => { 
    if (!audioCtxRef.current) audioCtxRef.current = new window.AudioContext(); 
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    setAudioEnabled(true);
    
    // Tiny tactical confirmation beep
    const o = audioCtxRef.current.createOscillator();
    const g = audioCtxRef.current.createGain();
    o.connect(g); g.connect(audioCtxRef.current.destination);
    o.frequency.value = 1200; g.gain.value = 0.1;
    o.start(); o.stop(audioCtxRef.current.currentTime + 0.05);
  };
  
  const playSiren = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    let count = 0;
    const interval = setInterval(() => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(count % 2 === 0 ? 600 : 900, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.5);
      if (++count >= 16) clearInterval(interval);
    }, 500);
  };

  // ─── ROUTES (OSRM) ─────────────────────────────────────────────────────────
  const routeFetchedRef = useRef(false);

  useEffect(() => {
    if (currentStatus !== 'en_route') {
      setRouteGeoJSON(null);
      setRouteSteps([]);
      routeFetchedRef.current = false;
      return;
    }

    if (!activeMission || !position || routeFetchedRef.current) return;

    // GPS Guard: Ignore fetch if position is still at 0,0 or undefined
    if (Math.abs(position[0]) < 0.1 && Math.abs(position[1]) < 0.1) {
      console.warn('[TacticalOSRM] Waiting for real GPS fix before fetching route.');
      return;
    }

    // Robust Coordinate Parsing
    let destLat, destLng;
    try {
      const loc = typeof activeMission.location === 'string' ? JSON.parse(activeMission.location) : activeMission.location;
      destLat = Number(activeMission.lat ?? activeMission.latitude ?? loc?.lat);
      destLng = Number(activeMission.lng ?? activeMission.longitude ?? loc?.lng);
    } catch (e) {
      destLat = Number(activeMission.lat ?? activeMission.latitude);
      destLng = Number(activeMission.lng ?? activeMission.longitude);
    }
    
    if (!destLat || !destLng || isNaN(destLat)) {
       console.error('[TacticalOSRM] Invalid destination coords:', destLat, destLng);
       return;
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${position[1]},${position[0]};${destLng},${destLat}?overview=full&geometries=geojson&steps=true&language=fr`;
    
    console.log('[TacticalOSRM] Fetching route to:', destLat, destLng);
    routeFetchedRef.current = true;
    
    const fetchRoute = (retryCount = 0) => {
      fetch(url)
        .then(res => {
           if (!res.ok) throw new Error('OSRM network error');
           return res.json();
        })
        .then(data => {
          if (data.routes?.[0]) {
            console.log('[TacticalOSRM] Route received successfully');
            setRouteGeoJSON(data.routes[0].geometry);
            setRouteSteps(data.routes[0].legs[0].steps);
          } else {
            console.warn('[TacticalOSRM] No route in response');
            if (retryCount < 2) setTimeout(() => fetchRoute(retryCount + 1), 2000);
          }
        })
        .catch(err => { 
          console.error('[TacticalOSRM] Fetch error', err);
          if (retryCount < 2) setTimeout(() => fetchRoute(retryCount + 1), 2000);
          else routeFetchedRef.current = false; 
        });
    };

    fetchRoute();
  }, [currentStatus, activeMission?.id, position]);

  // Handle Route Guidance Update
  useEffect(() => {
    if (currentStatus === 'en_route' && routeSteps.length > 0 && position) {
      // Find nearest step (Simplification)
      const nextStep = routeSteps.find((step, i) => i === routeSteps.length - 1 || step.distance > 0) || routeSteps[0];
      setGuidance({ text: nextStep.maneuver?.instruction || 'Continuez tout droit', distance: Math.max(0, Math.round(nextStep.distance)) });
    }
  }, [position, routeSteps, currentStatus]);

  // ─── ACTION HANDLERS ───────────────────────────────────────────────────────
  const changeStatus = (newStatus: string) => {
    if (!socket || !unit) return;
    const payload: any = { unitId: unit.id, status: newStatus, alertId: activeMission?.id };
    socket.emit('unit_status_update', payload);
    setUnit({ ...unit, status: newStatus });
    if (newStatus === 'available') {
      setActiveMission(null);
      localStorage.removeItem('sau_unit_mission');
    }
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  if (!unit) {
    return (
      <div className={styles.loginContainer} onClick={initAudio}>
        <div className={styles.loginCard}>
          <div className={styles.logo}>SAU <span style={{fontSize: 20}}>TACTICAL</span></div>
          <h1 className={styles.loginTitle}>IDENTIFICATION</h1>
          <p className={styles.loginSub}>Saisissez l'ID tactique de votre unité</p>
          {loginError && <div style={{ color: '#ef4444', marginBottom: 12, fontWeight: 'bold' }}>{loginError}</div>}
          <form onSubmit={e => { e.preventDefault(); loginUnit((e.target as any).uid.value); }}>
            <input name="uid" className={styles.loginInput} placeholder="Ex: AMB-01" required autoComplete="off" />
            <button type="submit" className={styles.combatBtnXxl} style={{ background: 'var(--tk-accent-blue)', color: '#fff' }}>CONNEXION</button>
          </form>
        </div>
      </div>
    );
  }

  // Get destination array
  const destCoords = activeMission ? [
    Number(activeMission.lat ?? activeMission.latitude ?? activeMission.location?.lat),
    Number(activeMission.lng ?? activeMission.longitude ?? activeMission.location?.lng)
  ] as [number, number] : null;

  return (
    <div className={styles.unitContainer}>
      <UnitHeader 
        unit={unit} 
        isOnline={!!socket?.connected} 
        socketConnected={!!socket?.connected}
        syncing={isSyncing}
        audioEnabled={audioEnabled}
        onActivateAudio={initAudio}
        onLogout={() => { localStorage.removeItem('sau_unit'); setUnit(null); }} 
        deferredPrompt={deferredPrompt}
        onInstall={() => {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
          }
        }}
      />

      <main className={styles.mapArea}>
        {position ? (
          <TacticalMapEngine
            center={position}
            heading={heading}
            speed={speed}
            navMode={currentStatus === 'en_route'}
            destination={destCoords}
            routeGeoJSON={routeGeoJSON}
          />
        ) : (
          <div className={styles.gpsLoader}>
            <div className={styles.gpsSpinner} />
            ACQUISITION SATELLITE...
          </div>
        )}
      </main>

      {/* Guidance Banner & Action Buttons */}
      <TacticalNav 
        status={currentStatus} 
        nextInstruction={guidance.text} 
        distanceToInstruction={guidance.distance} 
        missionType={activeMission?.type} 
        locationName={activeMission?.name} 
        onActionClick={() => {
          if (currentStatus === 'en_route') changeStatus('on_site');
          else if (currentStatus === 'on_site') setIsReporting(true);
        }} 
      />

      {/* Briefing Popup */}
      {pendingMission && (
        <MissionBriefing
          mission={pendingMission}
          routeData={null}
          onAccept={() => {
            setActiveMission(pendingMission);
            localStorage.setItem('sau_unit_mission', JSON.stringify(pendingMission));
            setPendingMission(null);
            changeStatus('en_route');
            if (Notification.permission !== 'denied') Notification.requestPermission();
          }}
          onRefuse={() => setPendingMission(null)}
          onViewPhoto={(url) => setViewingPhoto(url)}
        />
      )}

      {/* Wrap Up Report */}
      {isReporting && (
        <div className={styles.modalOverlay}>
          <ReportModal
            mission={activeMission}
            onCancel={() => setIsReporting(false)}
            onSubmit={async (data) => {
              try {
                await fetch(`/api/alerts/${activeMission.id}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ status: 'resolved', report: data }) });
                changeStatus('available');
                setIsReporting(false);
              } catch (e) { console.error(e); }
            }}
          />
        </div>
      )}

      {/* Photo view */}
      {viewingPhoto && (
         <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
           <img src={viewingPhoto} alt="Situation" style={{ maxWidth:'100%', maxHeight:'80vh', borderRadius:16 }} />
         </div>
      )}
    </div>
  );
}

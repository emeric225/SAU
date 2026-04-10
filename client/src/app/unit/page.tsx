'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useTacticalGPS } from './hooks/useTacticalGPS';
import { useOSRM } from './hooks/useOSRM';
import { useUnitSocket } from './hooks/useUnitSocket';

import { LoginScreen } from './components/LoginScreen';
import { TacticalMap } from './components/TacticalMap';
import { GuidanceBanner } from './components/GuidanceBanner';
import { MissionBriefing } from './components/MissionBriefing';
import { ReportModal } from './components/ReportModal';

/* ═══════════════════════════════ TYPES ═══════════════════════════════════ */
type UnitStatus = 'available' | 'en_route' | 'on_site';

interface Unit { id: string; name: string; status: UnitStatus; [k: string]: any; }
interface Mission { id: string; lat: number; lng: number; type: string; name?: string; phone?: string; notes?: string; photo_url?: string; [k: string]: any; }

/* ═══════════════════════════════ AUDIO ═══════════════════════════════════ */
function useAudio() {
  const ctxRef = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new window.AudioContext();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
  }, []);

  const beep = useCallback((freq = 880, durationS = 0.06, vol = 0.12) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = freq; g.gain.value = vol;
    o.start(); o.stop(ctx.currentTime + durationS);
  }, []);

  const siren = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (let i = 0; i < 8; i++) {
      setTimeout(() => {
        const now = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(i % 2 === 0 ? 660 : 880, now);
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        o.connect(g); g.connect(ctx.destination);
        o.start(now); o.stop(now + 0.5);
      }, i * 500);
    }
  }, []);

  return { unlock, beep, siren };
}

/* ═══════════════════════════════ POSITION SYNC ═══════════════════════════ */
function usePositionSync(
  unitId: string | null,
  status: UnitStatus | null,
  position: [number,number] | null,
  heading: number,
  speed: number,
  emitPosition: (lat: number, lng: number, h: number, s: number) => void,
) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!unitId || !position) return;

    timerRef.current = setInterval(() => {
      emitPosition(position[0], position[1], heading, speed);
    }, 3000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [unitId, status, position, heading, speed]);
}

/* ═══════════════════════════════ PAGE ════════════════════════════════════ */
export const dynamic = 'force-dynamic';

export default function UnitPage() {
  /* ── Auth & mission state ─────────────────────────────────────────── */
  const [unit, setUnit]                   = useState<Unit | null>(null);
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const activeMissionRef                  = useRef<Mission | null>(null);
  const [pendingMission, setPendingMission] = useState<Mission | null>(null);
  const [unitStatus, setUnitStatus]       = useState<UnitStatus>('available');
  const [loginError, setLoginError]       = useState('');
  const [loginLoading, setLoginLoading]   = useState(false);
  const [isReporting, setIsReporting]     = useState(false);
  const [viewingPhoto, setViewingPhoto]   = useState<string | null>(null);
  const [isConnected, setIsConnected]     = useState(false);
  const [audioReady, setAudioReady]       = useState(false);

  /* Keep ref in sync for async closures */
  useEffect(() => { activeMissionRef.current = activeMission; }, [activeMission]);

  /* ── GPS ──────────────────────────────────────────────────────────── */
  const { position, heading, speed } = useTacticalGPS();

  /* ── Audio ────────────────────────────────────────────────────────── */
  const audio = useAudio();

  /* ── OSRM ─────────────────────────────────────────────────────────── */
  const { route, fetchRoute, clearRoute } = useOSRM();

  /* Current navigation guidance step */
  const [guidanceStep, setGuidanceStep] = useState<{ text: string; distanceM: number }>({ text: '', distanceM: 0 });

  useEffect(() => {
    if (unitStatus === 'en_route' && route?.steps?.length && position) {
      const step = route.steps.find(s => s.distance > 0) || route.steps[0];
      setGuidanceStep({ text: step?.maneuver?.instruction || 'Continuez tout droit', distanceM: step?.distance || 0 });
    } else {
      setGuidanceStep({ text: '', distanceM: 0 });
    }
  }, [route?.steps, position, unitStatus]);

  /* ── Socket ─────────────────────────────────────────────────────── */
  const { emitStatus, emitPosition } = useUnitSocket({
    unitId: unit?.id ?? null,
    onConnectChange: setIsConnected,
    onMissionReceived: (mission) => {
      setPendingMission(mission);
      audio.siren();
      /* Browser notification */
      if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(`🚨 MISSION : ${mission.type?.toUpperCase()}`, {
            body: mission.notes || 'Déploiement immédiat',
            icon: '/icons/icon-192x192.png',
            vibrate: [200, 100, 200, 100, 400],
          });
        });
      }
    },
    onUnitUpdated: (u) => {
      if (u.status === 'available' && unitStatus !== 'available') {
        /* Remote cancellation by HQ */
        setUnitStatus('available');
        setActiveMission(null);
        activeMissionRef.current = null;
        clearRoute();
        alert('📻 MISSION ANNULÉE PAR LE QUARTIER GÉNÉRAL');
      }
      setUnit(prev => prev ? { ...prev, ...u } : null);
    },
  });

  /* ── Position sync to dashboard ─────────────────────────────────── */
  usePositionSync(unit?.id ?? null, unitStatus, position, heading, speed, emitPosition);

  /* ── Route: periodic retry every 5s while en_route + no route ────── */
  const positionRef = useRef<[number,number] | null>(null);
  useEffect(() => { positionRef.current = position; }, [position]);

  useEffect(() => {
    if (unitStatus !== 'en_route') {
      clearRoute();
      return;
    }

    const tryFetch = () => {
      const mission = activeMissionRef.current;
      const pos = positionRef.current;
      if (!mission || !pos) { console.log('[Route] Waiting for mission/GPS…'); return; }
      if (Math.abs(pos[0]) < 0.01 && Math.abs(pos[1]) < 0.01) { console.log('[Route] GPS at 0,0 — not ready'); return; }

      const destLat = Number(mission.lat ?? mission.latitude);
      const destLng = Number(mission.lng ?? mission.longitude);
      console.log('[Route] Coords check — destLat:', destLat, 'destLng:', destLng, 'mission:', mission.id);

      if (!destLat || !destLng || isNaN(destLat) || isNaN(destLng)) {
        console.error('[Route] ❌ Invalid coords in mission:', JSON.stringify(mission));
        return;
      }

      fetchRoute(pos, destLat, destLng);
    };

    // Try immediately
    tryFetch();

    // Then retry every 8s until route is loaded (useOSRM internally deduplicates via AbortController)
    const timer = setInterval(() => {
      // Stop retrying once we have a route
      if (route?.geometry) { clearInterval(timer); return; }
      tryFetch();
    }, 8000);

    return () => clearInterval(timer);
  }, [unitStatus, activeMission?.id]);

  /* ── Auth ───────────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = localStorage.getItem('sau_unit');
    if (!saved) return;
    try {
      const u = JSON.parse(saved);
      loginUnit(u.id);
    } catch { localStorage.removeItem('sau_unit'); }
  }, []);

  const loginUnit = async (stationId: string) => {
    setLoginLoading(true);
    setLoginError('');
    try {
      const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stationId }) });
      const data = await res.json();
      if (data.success && data.isUnit) {
        setUnit(data.station);
        setUnitStatus(data.station.status || 'available');
        localStorage.setItem('sau_unit', JSON.stringify(data.station));
        if (data.currentMission) {
          setActiveMission(data.currentMission);
          activeMissionRef.current = data.currentMission;
        }
        if (Notification.permission !== 'denied') Notification.requestPermission();
      } else {
        setLoginError(data.error || 'ID tactique invalide.');
      }
    } catch {
      setLoginError('Serveur injoignable – vérifiez votre connexion.');
    }
    setLoginLoading(false);
  };

  /* ── Status transitions ─────────────────────────────────────────── */
  const changeStatus = useCallback((newStatus: UnitStatus) => {
    setUnitStatus(newStatus);
    setUnit(prev => prev ? { ...prev, status: newStatus } : null);
    emitStatus(newStatus, activeMissionRef.current?.id);
    if (newStatus === 'available') {
      setActiveMission(null);
      activeMissionRef.current = null;
      clearRoute();
      localStorage.removeItem('sau_unit_mission');
    }
  }, [emitStatus, clearRoute]);

  /* ── Mission accept ─────────────────────────────────────────────── */
  const acceptMission = useCallback((mission: Mission) => {
    activeMissionRef.current = mission;
    setActiveMission(mission);
    localStorage.setItem('sau_unit_mission', JSON.stringify(mission));
    setPendingMission(null);
    audio.beep(1200, 0.08);
    setTimeout(() => changeStatus('en_route'), 80);
  }, [audio, changeStatus]);

  /* ─────────────────────────── RENDER ──────────────────────────────── */
  if (!unit) {
    return (
      <div onClick={() => { audio.unlock(); setAudioReady(true); }} style={{ minHeight: '100dvh' }}>
        <LoginScreen onLogin={loginUnit} error={loginError} loading={loginLoading} />
      </div>
    );
  }

  const destCoords: [number, number] | null = activeMission
    ? [Number(activeMission.lat ?? activeMission.latitude), Number(activeMission.lng ?? activeMission.longitude)]
    : null;

  const isDeployed = unitStatus === 'en_route' || unitStatus === 'on_site';

  return (
    <div
      onClick={() => { audio.unlock(); setAudioReady(true); }}
      style={{ position: 'fixed', inset: 0, background: '#060c1a', fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Map ── */}
      {position ? (
        <TacticalMap
          center={position}
          heading={heading}
          speed={speed}
          navMode={unitStatus === 'en_route'}
          destination={destCoords}
          routeGeoJSON={route?.geometry ?? null}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          color: '#475569', fontSize: 13, letterSpacing: 2,
        }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #1d4ed8', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
          ACQUISITION SATELLITE...
        </div>
      )}

      {/* ── Guidance banner (only when deployed) ── */}
      {isDeployed && (
        <GuidanceBanner
          status={unitStatus as 'en_route' | 'on_site'}
          instruction={guidanceStep.text}
          distanceM={guidanceStep.distanceM}
          missionType={activeMission?.type}
          onRetry={() => {
            if (position && destCoords) {
              fetchRoute(position, destCoords[0], destCoords[1]);
            }
          }}
        />
      )}

      {/* ── HUD top-right: status + call ── */}
      {!isDeployed && (
        <div style={{
          position: 'absolute', top: 'env(safe-area-inset-top, 12px)', right: 16, zIndex: 50,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <div style={{
            padding: '6px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: isConnected ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${isConnected ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: isConnected ? '#34d399' : '#f87171',
          }}>
            {isConnected ? '● LIAISON OK' : '○ RECONNEXION'}
          </div>
          <div style={{
            padding: '6px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8',
          }}>
            {unit.name}
          </div>
          <button
            onClick={() => { localStorage.removeItem('sau_unit'); setUnit(null); }}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '6px 10px', color: '#64748b', cursor: 'pointer', fontSize: 16 }}
            title="Déconnexion"
          >🚪</button>
        </div>
      )}

      {/* ── Audio unlock banner ── */}
      {!audioReady && (
        <div
          onClick={() => { audio.unlock(); setAudioReady(true); }}
          style={{
            position: 'absolute', top: isDeployed ? 90 : 56, left: 0, right: 0, zIndex: 60,
            background: 'rgba(37,99,235,0.9)', padding: '10px 16px',
            textAlign: 'center', fontSize: 13, color: '#fff', fontWeight: 700, letterSpacing: 1,
            cursor: 'pointer',
          }}
        >
          🔊 APPUYEZ POUR ACTIVER LE SON TACTIQUE
        </div>
      )}

      {/* ── Action button (bottom, contextual) ── */}
      {isDeployed && (
        <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', left: 16, right: 16, zIndex: 50, display: 'flex', gap: 12 }}>
          {/* Call button */}
          {activeMission?.phone && (
            <a
              href={`tel:${activeMission.phone}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 64, height: 64, borderRadius: 20, flexShrink: 0,
                background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.5)',
                fontSize: 26, textDecoration: 'none',
              }}
            >📞</a>
          )}
          {/* Main action */}
          <button
            onClick={() => {
              if (unitStatus === 'en_route') changeStatus('on_site');
              else if (unitStatus === 'on_site') setIsReporting(true);
            }}
            style={{
              flex: 1, padding: '18px', borderRadius: 20, border: 'none',
              background: unitStatus === 'en_route'
                ? 'linear-gradient(135deg, #1d4ed8, #2563eb)'
                : 'linear-gradient(135deg, #059669, #10b981)',
              color: '#fff', fontSize: 18, fontWeight: 900, letterSpacing: 1,
              cursor: 'pointer',
              boxShadow: unitStatus === 'en_route'
                ? '0 8px 32px rgba(37,99,235,0.45)'
                : '0 8px 32px rgba(5,150,105,0.45)',
            }}
          >
            {unitStatus === 'en_route' ? '📍 NOUS SOMMES SUR PLACE' : '📋 CLÔTURER L\'INTERVENTION'}
          </button>
        </div>
      )}

      {/* ── Pending mission briefing ── */}
      {pendingMission && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'flex-end',
        }}>
          <MissionBriefing
            mission={pendingMission}
            routeData={null}
            onAccept={() => acceptMission(pendingMission)}
            onRefuse={() => setPendingMission(null)}
            onViewPhoto={setViewingPhoto}
          />
        </div>
      )}

      {/* ── Report modal ── */}
      {isReporting && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center' }}>
          <ReportModal
            mission={activeMission}
            onCancel={() => setIsReporting(false)}
            onSubmit={async (data) => {
              try {
                await fetch(`/api/alerts/${activeMission?.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'resolved', report: data }),
                });
                changeStatus('available');
                setIsReporting(false);
              } catch (e) { console.error(e); }
            }}
          />
        </div>
      )}

      {/* ── Photo viewer ── */}
      {viewingPhoto && (
        <div
          onClick={() => setViewingPhoto(null)}
          style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewingPhoto} alt="Situation" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 16 }} />
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        body { overscroll-behavior: none; }
      `}</style>
    </div>
  );
}

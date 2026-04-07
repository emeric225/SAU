'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

const UnitMap = dynamic(() => import('../../components/Map'), { ssr: false });

// Default center: Abidjan
const DEFAULT_CENTER: [number, number] = [5.3365, -4.0268];

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export default function UnitInterface() {
  const [unitId, setUnitId] = useState('');
  const [unit, setUnit] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [mission, setMission] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const [gpsPos, setGpsPos] = useState<[number, number] | null>(null);
  const [gpsLocked, setGpsLocked] = useState(false);
  const gpsLockedRef = useRef(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [serverWaking, setServerWaking] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);

  // ─── Toast system ────────────────────────────────────────────────────────────
  const showToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 4000) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  // ─── Wake Lock ───────────────────────────────────────────────────────────────
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        console.log('[SAU] 🔆 Wake Lock activé — écran maintenu allumé');
      } catch (e) {
        console.warn('[SAU] Wake Lock non disponible', e);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // ─── Audio ────────────────────────────────────────────────────────────────────
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
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
        count++;
        if (count >= 20) clearInterval(interval);
      }, 500);
    } catch (e) { console.error('Audio error', e); }
  }, []);

  // ─── Download photo ───────────────────────────────────────────────────────────
  const handleDownloadPhoto = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `SAU-Terrain-Photo-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  // ─── Login with retry ─────────────────────────────────────────────────────────
  const loginUnit = async () => {
    if (!unitId || loading) return;
    setLoading(true);
    setRetryCount(0);
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
        } else {
          showToast('❌ ID Unité non valide (ex: u1, u2)', 'error');
          return false;
        }
      } catch (e: any) {
        if (attempt < 3) {
          setRetryCount(attempt);
          if (attempt === 1) setServerWaking(true);
          await new Promise(r => setTimeout(r, 3000 * attempt));
          return attemptLogin(attempt + 1);
        }
        showToast('🔴 Impossible de joindre le serveur. Vérifiez votre connexion.', 'error', 6000);
        return false;
      }
    };

    await attemptLogin(1);
    setLoading(false);
    setServerWaking(false);
    setRetryCount(0);
  };

  // ─── Socket ───────────────────────────────────────────────────────────────────
  const initSocket = useCallback((id: string) => {
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    const s = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = s;
    setSocket(s);
    s.emit('join_room', id);

    s.on('connect', () => {
      setSocketConnected(true);
      showToast('📡 Liaison réseau établie', 'success', 2500);
    });

    s.on('disconnect', () => {
      setSocketConnected(false);
      showToast('⚠️ Liaison réseau perdue — reconnexion...', 'warning');
    });

    s.on('reconnect', () => {
      setSocketConnected(true);
      s.emit('join_room', id);
      showToast('📡 Liaison rétablie', 'success', 2500);
    });

    s.on('mission_received', (alertObj: any) => {
      setMission(alertObj);
      localStorage.setItem('sau_unit_mission', JSON.stringify(alertObj));
      playSiren();
      showToast('🚨 NOUVELLE MISSION ASSIGNÉE !', 'error', 8000);
    });

    s.on('unit_updated', (updatedUnit: any) => {
      if (updatedUnit.id === id) {
        setUnit((prev: any) => ({ ...prev, status: updatedUnit.status }));
      }
    });
  }, [playSiren, showToast]);

  // ─── Recovery on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    const session = localStorage.getItem('sau_unit');
    const savedMission = localStorage.getItem('sau_unit_mission');

    if (savedMission) {
      try { setMission(JSON.parse(savedMission)); } catch (e) {}
    }

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
                  // Only clear mission if unit is truly available
                  setMission(null);
                  localStorage.removeItem('sau_unit_mission');
                }
                initSocket(data.station.id);
                requestWakeLock();
              }
          })
          .catch(() => {
            // Server unavailable at startup — keep local state, show offline
            showToast('⚠️ Reconnexion hors-ligne — données locales utilisées', 'warning');
          })
          .finally(() => setLoading(false));
      } catch (e) { setLoading(false); }
    }

    return () => {
      releaseWakeLock();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── GPS Tracking ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!unit || !socket) return;
    // Reset lock ref when unit changes (new login)
    gpsLockedRef.current = false;
    setGpsLocked(false);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Use ref to avoid stale closure — fires toast only once per session
        if (!gpsLockedRef.current) {
          gpsLockedRef.current = true;
          setGpsLocked(true);
          showToast('📍 GPS verrouillé', 'success', 2000);
        }
        setGpsPos([lat, lng]);
        setUnit((prev: any) => prev ? { ...prev, lat, lng } : prev);
        socket.emit('update_unit_position', { unitId: unit.id, lat, lng });
      },
      (err) => {
        console.warn('[SAU] GPS error:', err.message);
        if (!gpsLockedRef.current) {
          // Fallback: use default position
          setGpsPos(DEFAULT_CENTER);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.id, socket]);

  // ─── Show map even without GPS ────────────────────────────────────────────────
  useEffect(() => {
    if (unit && !gpsPos) {
      // Show map at default position after 3s if no GPS
      const t = setTimeout(() => {
        setGpsPos([unit.lat || DEFAULT_CENTER[0], unit.lng || DEFAULT_CENTER[1]]);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [unit, gpsPos]);

  // ─── PWA & offline ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleBeforeInstall = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    const handleOnline = () => { setIsOnline(true); syncOfflineReports(); };
    const handleOffline = () => { setIsOnline(false); showToast('📵 Mode hors-ligne activé', 'warning'); };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && unit) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [unit, requestWakeLock]);

  // ─── Sync offline reports ─────────────────────────────────────────────────────
  const syncOfflineReports = async () => {
    const queue = JSON.parse(localStorage.getItem('sau_offline_reports') || '[]');
    if (queue.length === 0) return;
    setSyncing(true);
    let success = 0;
    for (const item of queue) {
      try {
        await fetch(`/api/alerts/${item.missionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: item.status, report: item.reportData }),
        });
        success++;
      } catch (e) { break; }
    }
    localStorage.removeItem('sau_offline_reports');
    setSyncing(false);
    if (success > 0) showToast(`✅ ${success} rapport(s) synchronisé(s)`, 'success');
  };

  // ─── Logout ───────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    localStorage.removeItem('sau_unit');
    localStorage.removeItem('sau_unit_mission');
    if (socketRef.current) socketRef.current.disconnect();
    socketRef.current = null;
    setUnit(null);
    setMission(null);
    setSocket(null);
    setSocketConnected(false);
    setUnitId('');
    setGpsPos(null);
    setGpsLocked(false);
    setRouteData(null);
    releaseWakeLock();
  };

  // ─── Install PWA ──────────────────────────────────────────────────────────────
  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { setDeferredPrompt(null); showToast('✅ App installée avec succès !', 'success'); }
  };

  // ─── Update status ────────────────────────────────────────────────────────────
  const updateStatus = (status: string) => {
    if (socket && unit) {
      socket.emit('unit_status_update', { unitId: unit.id, status, alertId: mission?.id });
      setUnit({ ...unit, status });
      if (status === 'available') {
        setMission(null);
        localStorage.removeItem('sau_unit_mission');
        setRouteData(null);
        showToast('✅ Mission terminée — Unité disponible', 'success');
      } else if (status === 'en_route') {
        showToast('🚒 En route vers la mission !', 'info');
      } else if (status === 'on_site') {
        showToast('📍 Arrivée sur place signalée', 'success');
      }
    }
  };

  // ─── Report submit ────────────────────────────────────────────────────────────
  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const reportData = {
      actions: (form as any).actions.value,
      conclusion: (form as any).conclusion.value,
      victimes: (form as any).victimes.value,
      timestamp: new Date(),
    };

    if (!navigator.onLine) {
      const queue = JSON.parse(localStorage.getItem('sau_offline_reports') || '[]');
      queue.push({ missionId: mission.id, reportData, status: 'resolved' });
      localStorage.setItem('sau_offline_reports', JSON.stringify(queue));
      showToast('⚠️ Rapport sauvegardé localement — sera envoyé au retour du réseau', 'warning', 6000);
      updateStatus('available');
      setMission(null);
      setRouteData(null);
      setShowReport(false);
      return;
    }

    try {
      const res = await fetch(`/api/alerts/${mission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', report: reportData }),
      });
      if (res.ok) {
        updateStatus('available');
        setMission(null);
        setRouteData(null);
        setShowReport(false);
      }
    } catch (err) {
      console.error('Report submission error:', err);
      showToast('❌ Erreur lors de la soumission du rapport', 'error');
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  const getStatusLabel = (status: string) => {
    if (status === 'on_site') return 'SUR PLACE';
    if (status === 'en_route') return 'EN ROUTE';
    return 'DISPONIBLE';
  };

  const getStatusClass = (status: string) => {
    if (status === 'on_site') return styles.badgeOnSite;
    if (status === 'en_route') return styles.badgeEnRoute;
    return styles.badgeAvailable;
  };

  const getETA = () => {
    if (!routeData) return null;
    const now = new Date();
    now.setMinutes(now.getMinutes() + Math.ceil(routeData.durationMin));
    return now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const mapCenter: [number, number] = gpsPos || DEFAULT_CENTER;

  // ═══════════════════════════════════════════════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════════════════════════
  if (!unit) {
    return (
      <div className={styles.unitContainer}>
        <div className={styles.loginContainer}>
          <div className={styles.loginCard}>
            <div className={styles.loginLogoWrap}>
              <div className={styles.logo}>SAU</div>
              <div className={styles.logoPulse}></div>
            </div>
            <h1 className={styles.loginTitle}>UNITÉ TACTIQUE</h1>
            <p className={styles.loginSub}>Identifiez votre véhicule pour rejoindre le réseau opérationnel</p>

            {serverWaking && (
              <div className={styles.serverWakeAlert}>
                <div className={styles.serverWakeSpinner}></div>
                <div>
                  <div className={styles.serverWakeTitle}>Réveil du serveur en cours...</div>
                  <div className={styles.serverWakeSubtitle}>Tentative {retryCount}/3 — merci de patienter ~15s</div>
                </div>
              </div>
            )}

            <input
              autoFocus
              type="text"
              placeholder="Ex: u1, u2, u3..."
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={styles.loginInput}
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && loginUnit()}
            />
            <button
              className={styles.btnLogin}
              onClick={loginUnit}
              disabled={loading}
            >
              {loading ? (
                <span className={styles.loginLoadingRow}>
                  <span className={styles.btnSpinner}></span>
                  {serverWaking ? 'RÉVEIL SERVEUR...' : 'AUTHENTIFICATION...'}
                </span>
              ) : 'REJOINDRE LE RÉSEAU'}
            </button>

            <div className={styles.loginFooter}>
              Système d'Alerte d'Urgence v2.3 — SAU Côte d'Ivoire
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MAIN INTERFACE
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div className={styles.unitContainer}>

      {/* ── Toast Notifications ── */}
      <div className={styles.toastContainer}>
        {toasts.map(t => (
          <div key={t.id} className={`${styles.toast} ${styles[`toast_${t.type}`]}`}>
            {t.message}
          </div>
        ))}
      </div>

      {/* ── Audio Banner ── */}
      {!audioEnabled && (
        <div className={styles.audioBanner} onClick={() => {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          setAudioEnabled(true);
          showToast('🔊 Son activé', 'success', 2000);
        }}>
          🔊 APPUYEZ POUR ACTIVER LE SON DES ALERTES
        </div>
      )}

      {/* ── Header ── */}
      <div className={styles.header} style={{ marginTop: audioEnabled ? 0 : '44px' }}>
        <div className={styles.headerLeft}>
          <div className={styles.unitName}>{unit?.name || 'Unité SAU'}</div>
          <div className={styles.headerMeta}>
            <div className={`${styles.badge} ${getStatusClass(unit?.status)}`}>
              {getStatusLabel(unit?.status)}
            </div>
            {!isOnline && <span className={styles.offlineTag}>HORS LIGNE</span>}
            {syncing && <span className={styles.syncingTag}>SYNCHRO...</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          {deferredPrompt && (
            <button className={styles.btnInstall} onClick={handleInstallClick} title="Installer l'app">
              ⬇ Installer
            </button>
          )}
          <div className={`${styles.connectionStatus} ${socketConnected ? styles.connOnline : styles.connOffline}`}>
            <div className={styles.statusDot}></div>
            <span>{socketConnected ? 'Liaison OK' : 'Reconnexion...'}</span>
          </div>
          <button onClick={handleLogout} className={styles.btnLogout} title="Déconnexion">🚪</button>
        </div>
      </div>

      {/* ── Google Maps-style Navigation Bar (top) when en_route ── */}
      {mission && unit?.status === 'en_route' && (
        <div className={styles.navInstructionBar}>
          <div className={styles.navArrow}>↑</div>
          <div className={styles.navInstruction}>
            <div className={styles.navInstructionMain}>
              {routeData ? `Continuer vers ${mission.type?.toUpperCase() || 'URGENCE'}` : 'CALCUL DE L\'ITINÉRAIRE...'}
            </div>
            {routeData && (
              <div className={styles.navInstructionSub}>
                {routeData.distanceKm.toFixed(1)} km restants
              </div>
            )}
          </div>
          {mission.phone && (
            <a href={`tel:${mission.phone}`} className={styles.navCallBtn} title="Appeler le signalant">
              📞
            </a>
          )}
        </div>
      )}

      {/* ── Mission banner (on_site) ── */}
      {mission && unit?.status === 'on_site' && (
        <div className={styles.onSiteBanner}>
          <span className={styles.missionPulse}>●</span>
          <strong>{mission.type?.toUpperCase() || 'URGENCE'} — SUR PLACE</strong>
          {mission.phone && <a href={`tel:${mission.phone}`} className={styles.btnCall}>📞 APPELER</a>}
        </div>
      )}

      {/* ── Map Area ── */}
      <div className={styles.mapArea}>
        {gpsPos ? (
          <UnitMap
            stations={[]}
            alerts={mission ? [mission] : []}
            units={unit?.status === 'en_route' ? [] : [unit]}
            selectedAlert={mission}
            navigationActive={unit?.status === 'en_route'}
            onRouteDataReady={(d) => setRouteData(d)}
            center={mapCenter}
            isLiveUnitMode={true}
          />
        ) : (
          <div className={styles.gpsLoader}>
            <div className={styles.gpsSpinner}></div>
            <strong>CALIBRAGE GPS...</strong>
            <span>Acquisition des coordonnées du véhicule</span>
          </div>
        )}
      </div>

      {/* ── Google Maps-style Bottom ETA Bar (en_route) ── */}
      {mission && unit?.status === 'en_route' && (
        <div className={styles.etaBar}>
          <div className={styles.etaBlock}>
            <div className={styles.etaValue}>{routeData ? Math.ceil(routeData.durationMin) : '--'}</div>
            <div className={styles.etaLabel}>min</div>
          </div>
          <div className={styles.etaDivider}></div>
          <div className={styles.etaBlock}>
            <div className={styles.etaValue}>{routeData ? routeData.distanceKm.toFixed(1) : '--'}</div>
            <div className={styles.etaLabel}>km</div>
          </div>
          <div className={styles.etaDivider}></div>
          <div className={styles.etaBlock}>
            <div className={styles.etaValue}>{getETA() || '--:--'}</div>
            <div className={styles.etaLabel}>arrivée</div>
          </div>
          <button
            onClick={() => updateStatus('on_site')}
            className={styles.etaArriveBtn}
          >
            📍 Arrivé
          </button>
        </div>
      )}

      {/* ── Mission Popup (new mission, status=available) ── */}
      {mission && unit?.status === 'available' && (
        <div className={styles.popup}>
          <div className={styles.popupHeader}>
            <div className={styles.popupAlertDot}></div>
            <h3 className={styles.popupTitle}>MISSION ASSIGNÉE</h3>
          </div>
          <p className={styles.popupType}>{mission.type?.toUpperCase() || 'URGENCE'}</p>

          {mission.photo_url && (
            <div className={styles.missionPhotoThumb} onClick={() => setViewingPhoto(mission.photo_url)}>
              <img src={mission.photo_url} alt="Photo du signalement" />
              <div className={styles.photoZoomIcon}>🔍</div>
            </div>
          )}

          <div className={styles.popupDetailsGrid}>
            <div className={styles.popupDetailRow}>
              <span className={styles.popupDetailLabel}>👤 Appelant</span>
              <span>{mission.name || 'ANONYME'}</span>
            </div>
            <div className={styles.popupDetailRow}>
              <span className={styles.popupDetailLabel}>📞 Contact</span>
              <a href={`tel:${mission.phone}`} className={styles.popupPhone}>{mission.phone || 'N/A'}</a>
            </div>
            {routeData && (
              <div className={styles.popupDetailRow}>
                <span className={styles.popupDetailLabel}>🗺️ Distance</span>
                <span className={styles.popupEta}>{routeData.distanceKm.toFixed(1)} km — {Math.ceil(routeData.durationMin)} min</span>
              </div>
            )}
            {mission.notes && (
              <div className={styles.missionNotes}>
                <strong>📋 Détails :</strong>
                <p>{mission.notes}</p>
              </div>
            )}
          </div>

          <div className={styles.popupActions}>
            <button onClick={() => updateStatus('en_route')} className={styles.btnAccept}>
              ✅ ACCEPTER
            </button>
            <button onClick={() => { setMission(null); localStorage.removeItem('sau_unit_mission'); }} className={styles.btnRefuse}>
              ✕ Refuser
            </button>
          </div>
        </div>
      )}

      {/* ── Nav Panel (on_site: show "validate mission" button) ── */}
      {unit?.status === 'on_site' && (
        <div className={styles.navPanel}>
          {mission ? (
            <button onClick={() => setShowReport(true)} className={`${styles.btnAction} ${styles.btnResolved}`}>
              ✅ VALIDER LA MISSION
            </button>
          ) : (
            <div className={styles.syncWarning}>
              ⚠️ Mission non synchronisée
            </div>
          )}
          <div className={styles.forceStatusRow}>
            <label className={styles.forceStatusLabel}>Statut :</label>
            <select
              value={unit.status}
              onChange={(e) => updateStatus(e.target.value)}
              className={styles.forceStatusSelect}
            >
              <option value="en_route">En route</option>
              <option value="on_site">Sur place</option>
              <option value="available">Libérer l'unité (Disponible)</option>
            </select>
          </div>
        </div>
      )}

      {/* ── Report Modal ── */}
      {showReport && mission && (
        <div className={styles.modalOverlay}>
          <div className={styles.reportCard}>
            <div className={styles.reportHeader}>
              <h2 className={styles.reportTitle}>RAPPORT D'INTERVENTION</h2>
              <p className={styles.reportSub}>{mission.type?.toUpperCase()} — {mission.name}</p>
            </div>
            <form className={styles.reportForm} onSubmit={handleReportSubmit}>
              <div className={styles.formGroup}>
                <label>Actions Prises</label>
                <textarea name="actions" required placeholder="Décrivez les actions effectuées..." className={styles.reportTextarea}></textarea>
              </div>
              <div className={styles.formGroup}>
                <label>Victimes / Bilan</label>
                <input type="text" name="victimes" placeholder="Ex: 1 blessé léger, aucune victime..." className={styles.reportInput} />
              </div>
              <div className={styles.formGroup}>
                <label>Conclusion</label>
                <select name="conclusion" required className={styles.reportSelect}>
                  <option value="success">Mission Réussie</option>
                  <option value="transferred">Transféré aux Autorités</option>
                  <option value="false_alarm">Fausse Alerte</option>
                </select>
              </div>
              <div className={styles.reportActions}>
                <button type="submit" className={styles.btnSubmitReport}>Soumettre le Rapport</button>
                <button type="button" className={styles.btnCancelReport} onClick={() => setShowReport(false)}>Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Photo Viewer Modal ── */}
      {viewingPhoto && (
        <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
          <div className={styles.photoViewerContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.btnClosePhoto} onClick={() => setViewingPhoto(null)}>✕</button>
            <img src={viewingPhoto} alt="Zoom Alerte" className={styles.photoViewerImage} />
            <div className={styles.photoViewerActions}>
              <button className={styles.btnDownloadPhoto} onClick={() => handleDownloadPhoto(viewingPhoto)}>
                📥 Télécharger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

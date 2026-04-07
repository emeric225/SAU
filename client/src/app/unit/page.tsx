'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import styles from './unit.module.css';

const UnitMap = dynamic(() => import('../../components/Map'), { ssr: false });

export default function UnitInterface() {
  const [unitId, setUnitId] = useState('');
  const [unit, setUnit] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [mission, setMission] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const [gpsLocked, setGpsLocked] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('sau_unit');
    if (socket) socket.disconnect();
    setUnit(null);
    setMission(null);
    setSocket(null);
    setUnitId('');
  };

  const playSiren = () => {
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
    } catch (e) { console.error("Audio error", e); }
  };

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
      console.error('Failed to download image', e);
      window.open(url, '_blank');
    }
  };

  const loginUnit = async () => {
    if (!unitId || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: unitId })
      });
      const data = await res.json();
      if (data.success && data.isUnit) {
        setUnit(data.station);
        localStorage.setItem('sau_unit', JSON.stringify(data.station));
        if (data.currentMission) {
          setMission(data.currentMission);
        }
        initSocket(data.station.id);
      } else {
        alert("ID Unité non valide (ex: u1, u2)");
      }
    } catch (e) { 
      console.error(e);
      alert("Erreur de connexion au serveur");
    } finally {
      setLoading(false);
    }
  };

  const initSocket = (id: string) => {
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';
    const s = io(serverUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true
    });
    setSocket(s);
    s.emit('join_room', id);

    s.on('mission_received', (alertObj) => {
      setMission(alertObj);
      playSiren();
    });
  };

  // RECOVERY ON MOUNT
  useEffect(() => {
    const session = localStorage.getItem('sau_unit');
    if (session) {
      try {
        const unitData = JSON.parse(session);
        setUnitId(unitData.id);
        // Force re-auth to get latest mission
        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stationId: unitData.id })
        }).then(r => r.json()).then(data => {
            if (data.success && data.isUnit) {
              setUnit(data.station);
              if (data.currentMission) setMission(data.currentMission);
              initSocket(data.station.id);
            }
        });
      } catch(e) {}
    }
  }, []);

  // PWA & OFFLINE LOGIC
  useEffect(() => {
    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineReports();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const syncOfflineReports = async () => {
    const queue = JSON.parse(localStorage.getItem('sau_offline_reports') || '[]');
    if (queue.length === 0) return;

    setSyncing(true);
    for (const item of queue) {
      try {
        await fetch(`/api/alerts/${item.missionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: item.status, report: item.reportData })
        });
      } catch (e) { break; }
    }
    localStorage.removeItem('sau_offline_reports');
    setSyncing(false);
    alert("✅ Rapports hors-ligne synchronisés avec succès.");
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  const updateStatus = (status: string) => {
    if (socket && unit) {
      socket.emit('unit_status_update', { unitId: unit.id, status, alertId: mission?.id });
      setUnit({ ...unit, status });
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const reportData = {
      actions: form.actions.value,
      conclusion: form.conclusion.value,
      victimes: form.victimes.value,
      timestamp: new Date()
    };

    try {
      if (!navigator.onLine) {
        const queue = JSON.parse(localStorage.getItem('sau_offline_reports') || '[]');
        queue.push({ missionId: mission.id, reportData, status: 'resolved' });
        localStorage.setItem('sau_offline_reports', JSON.stringify(queue));
        alert("⚠️ Connexion perdue. Rapport sauvegardé localement. Il sera envoyé automatiquement au retour du réseau.");
        updateStatus('available');
        setMission(null);
        setRouteData(null);
        setShowReport(false);
        return;
      }

      const res = await fetch(`/api/alerts/${mission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', report: reportData })
      });
      if (res.ok) {
        updateStatus('available');
        setMission(null);
        setRouteData(null);
        setShowReport(false);
      }
    } catch (err) {
      console.error("Report submission error:", err);
    }
  };

  useEffect(() => {
    if (!unit || !socket) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsLocked(true);
        setUnit((prev: any) => prev ? { ...prev, lat, lng } : prev);
        socket.emit('update_unit_position', { unitId: unit.id, lat, lng });
      },
      (err) => console.warn(err),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [unit?.id, socket]);

  if (!unit) {
    return (
      <div className={styles.unitContainer}>
        <div className={styles.loginContainer}>
          <div className={styles.loginCard}>
            <div className={styles.logo}>SAU</div>
            <h1 className={styles.loginTitle}>UNITÉ TACTIQUE</h1>
            <p className={styles.loginSub}>Identifiez votre véhicule pour rejoindre le réseau opérationnel</p>
            
            <input
              autoFocus
              type="text"
              placeholder="Ex: u1"
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
              {loading ? 'AUTHENTIFICATION...' : 'REJOINDRE LE RÉSEAU'}
            </button>

            <div className={styles.loginFooter}>
              Système de Navigation d'Urgence v2.2
            </div>
          </div>
        </div>
      </div>
    );
  }

  const getBadgeClass = (status: string) => {
    if (status === 'en_route') return styles.badgeEnRoute;
    if (status === 'on_site') return styles.badgeOnSite;
    return styles.badgeAvailable;
  };

  return (
    <div className={styles.unitContainer}>
      {/* Audio activation banner */}
      {!audioEnabled && (
        <div className={styles.audioBanner} onClick={() => {
           audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
           setAudioEnabled(true);
        }}>
          🚨 CLIQUER ICI POUR ACTIVER LE SON DES MISSIONS
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <h1 className={styles.unitName}>{unit ? unit.name : 'Unité SAU'}</h1>
            <div className={`${styles.badge} ${unit?.status === 'available' ? styles.badgeAvailable : unit?.status === 'en_route' ? styles.badgeEnRoute : styles.badgeOnSite}`}>
              {unit ? (unit.status === 'on_site' ? 'SUR PLACE' : unit.status === 'en_route' ? 'EN ROUTE' : 'DISPONIBLE') : 'HORS LIGNE'}
            </div>
            {!isOnline && <span className={styles.offlineTag}>HORS LIGNE</span>}
          </div>
          {deferredPrompt && (
            <button className={styles.btnInstall} onClick={handleInstallClick}>
              INSTALLER APP
            </button>
          )}
        </div>
        <div className={styles.headerActions}>
          <div className={styles.connectionStatus}>
            <div className={`${styles.statusDot} ${socket?.connected ? styles.online : styles.offline}`}></div>
            {socket?.connected ? 'Liaison OK' : 'Réseau Instable'}
          </div>
          <button onClick={handleLogout} className={styles.btnLogout} title="Déconnexion">
            🚪
          </button>
        </div>
      </div>

      {/* Persistent Mission Info for ongoing missions */}
      {mission && unit.status !== 'available' && (
        <div className={styles.activeMissionHeader}>
           <span className={styles.missionPulse}>●</span>
           <strong>{mission.type?.toUpperCase()} EN COURS</strong>
           {mission.phone && <a href={`tel:${mission.phone}`} className={styles.btnCall}>📞 APPELER</a>}
        </div>
      )}

      {/* Map Area */}
      <div className={styles.mapArea}>
         {gpsLocked ? (
           <UnitMap 
             stations={[]} 
             alerts={mission ? [mission] : []}
             units={unit.status === 'en_route' ? [] : [unit]}
             selectedAlert={mission}
             navigationActive={unit.status === 'en_route'}
             onRouteDataReady={(d) => setRouteData(d)}
             center={[unit.lat, unit.lng]}
             isLiveUnitMode={true}
           />
         ) : (
           <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0a0a0a', color: '#3b82f6' }}>
              <div style={{ fontSize: '32px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>🌍</div>
              <strong>CALIBRAGE GPS EN COURS...</strong>
              <span style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>Acquisition des coordonnées du véhicule</span>
           </div>
         )}
      </div>

      {/* Mission Popup */}
      {mission && unit.status === 'available' && (
        <div className={styles.popup}>
          <h3 className={styles.popupTitle}>
            🚨 MISSION ASSIGNÉE
          </h3>
          <p className={styles.popupText}>URGENCE: {mission.type.toUpperCase()}</p>
          {mission.photo_url && (
            <div className={styles.missionPhotoThumb} onClick={() => setViewingPhoto(mission.photo_url)}>
              <img src={mission.photo_url} alt="Photo du signalement" />
            </div>
          )}
          <div className={styles.popupDetailsGrid}>
            <div><strong>APPELANT:</strong> {mission.name || 'ANONYME'}</div>
            <div><strong>CONTACT:</strong> {mission.phone}</div>
            <div className={styles.missionNotes}>
              <strong>DÉTAILS:</strong><br/>
              {mission.notes || 'Aucun détail fourni.'}
            </div>
            {routeData && (
              <div style={{gridColumn: '1/-1', color: '#f97316', fontWeight: 800, marginTop: '8px'}}>
                📍 {routeData.distanceKm.toFixed(1)} km — ETA: {Math.ceil(routeData.durationMin)} min
              </div>
            )}
          </div>
          
          <div className={styles.actions}>
            <button onClick={() => updateStatus('en_route')} className={styles.btnAccept}>
              ✅ ACCEPTER
            </button>
            <button onClick={() => setMission(null)} className={styles.btnRefuse}>
              ❌ REFUSER
            </button>
          </div>
        </div>
      )}

      {/* Active Navigation Panel */}
      {mission && unit.status === 'en_route' && routeData && (
        <div className={styles.floatingEta}>
          <div className={styles.etaValue}>{Math.ceil(routeData.durationMin)}<span style={{fontSize: '16px'}}> min</span></div>
          <div className={styles.etaDistance}>{routeData.distanceKm.toFixed(1)} km</div>
        </div>
      )}

      {mission && unit.status !== 'available' && (
        <div className={styles.navPanel}>
           {unit.status === 'en_route' ? (
             <button onClick={() => updateStatus('on_site')} className={`${styles.btnAction} ${styles.btnOnSite}`}>
               📍 SIGNALER ARRIVÉE SUR PLACE
             </button>
           ) : (
             <button onClick={() => setShowReport(true)} className={`${styles.btnAction} ${styles.btnResolved}`}>
               ✅ VALIDER LA MISSION
             </button>
           )}
        </div>
      )}

      {/* Report Modal */}
      {showReport && mission && (
        <div className={styles.modalOverlay}>
          <div className={styles.reportCard}>
            <div className={styles.reportHeader}>
              <h2 className={styles.reportTitle}>RAPPORT D'INTERVENTION</h2>
              <p className={styles.reportSub}>Mission : {mission.type.toUpperCase()} - {mission.name}</p>
            </div>
            <form className={styles.reportForm} onSubmit={handleReportSubmit}>
              <div className={styles.formGroup}>
                <label>Actions Prises</label>
                <textarea name="actions" required placeholder="Décrivez les actions effectuées..." className={styles.reportTextarea}></textarea>
              </div>
              <div className={styles.formGroup}>
                <label>Victimes / Bilan</label>
                <input type="text" name="victimes" placeholder="Ex: 1 blessé léger" className={styles.reportInput} />
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

      {/* PHOTO VIEWER MODAL */}
      {viewingPhoto && (
        <div className={styles.photoViewerOverlay} onClick={() => setViewingPhoto(null)}>
          <div className={styles.photoViewerContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.btnClosePhoto} onClick={() => setViewingPhoto(null)}>✕</button>
            <img src={viewingPhoto} alt="Zoom Alerte" className={styles.photoViewerImage} />
            <div className={styles.photoViewerActions}>
               <button className={styles.btnDownloadPhoto} onClick={() => handleDownloadPhoto(viewingPhoto)}>
                 📥 Télécharger la photo
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

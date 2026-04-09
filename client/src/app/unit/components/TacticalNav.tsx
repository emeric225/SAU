'use client';

import React from 'react';
import styles from '../unit.module.css';

interface TacticalNavProps {
  mission: any;
  unitStatus: string;
  routeData: any;
  onUpdateStatus: (status: string) => void;
  onShowReport: () => void;
  getFormattedArrival: () => string;
}

export const TacticalNav: React.FC<TacticalNavProps> = ({
  mission,
  unitStatus,
  routeData,
  onUpdateStatus,
  onShowReport,
  getFormattedArrival
}) => {
  if (!mission) return null;

  if (unitStatus === 'en_route') {
    return (
      <>
        {/* L'instruction de navigation est maintenant gérée par le composant Map en XXL */}
        
        {/* Floating Call Button if needed */}
        {mission.phone && (
          <div style={{ position: 'fixed', top: '110px', right: '35px', zIndex: 6000 }}>
             <a href={`tel:${mission.phone}`} className={styles.navCallBtn}>📞</a>
          </div>
        )}

        {/* Bottom ETA bar */}
        <div className={styles.etaBar}>
          <div className={styles.etaBlock}>
            <div className={styles.etaValue}>{routeData ? Math.ceil(routeData.durationMin) : '--'}</div>
            <div className={styles.etaLabel}>MIN</div>
          </div>
          <div className={styles.etaDivider}></div>
          <div className={styles.etaBlock}>
            <div className={styles.etaValue}>{routeData ? routeData.distanceKm.toFixed(1) : '--'}</div>
            <div className={styles.etaLabel}>KM</div>
          </div>
          <div className={styles.etaDivider}></div>
          <div className={styles.etaArriveBtn} onClick={() => onUpdateStatus('on_site')} style={{ cursor: 'pointer', background: '#f59e0b', color: '#000', fontWeight: 900, padding: '14px 20px', borderRadius: 16, fontSize: 14, border: 'none', whiteSpace: 'nowrap' }}>
            📍 SUR PLACE
          </div>
        </div>
      </>
    );
  }

  if (unitStatus === 'on_site') {
    return (
      <div className={styles.navPanel}>
        <div className={styles.onSiteHeader}>
          <span className={styles.missionPulse}>●</span>
          <strong>MISSION EN COURS — SUR PLACE</strong>
        </div>
        
        <button 
          onClick={onShowReport} 
          className={styles.combatBtnXxl}
          style={{ backgroundColor: '#10b981', color: '#000' }}
        >
          ✅ CLÔTURER LA MISSION
        </button>

        <div className={styles.forceStatusRow}>
          <label className={styles.forceStatusLabel}>STATUT :</label>
          <select 
            value={unitStatus} 
            onChange={(e) => onUpdateStatus(e.target.value)}
            className={styles.forceStatusSelect}
          >
            <option value="en_route">En route</option>
            <option value="on_site">Sur place</option>
            <option value="available">Terminer (Disponible)</option>
          </select>
        </div>
      </div>
    );
  }

  return null;
};

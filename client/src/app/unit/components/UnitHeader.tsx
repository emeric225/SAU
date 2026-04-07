'use client';

import React from 'react';
import styles from '../unit.module.css';

interface UnitHeaderProps {
  unit: any;
  socketConnected: boolean;
  isOnline: boolean;
  syncing: boolean;
  audioEnabled: boolean;
  onActivateAudio: () => void;
  onLogout: () => void;
  deferredPrompt: any;
  onInstall: () => void;
}

export const UnitHeader: React.FC<UnitHeaderProps> = ({
  unit,
  socketConnected,
  isOnline,
  syncing,
  audioEnabled,
  onActivateAudio,
  onLogout,
  deferredPrompt,
  onInstall
}) => {
  const getStatusLabel = (status: string) => {
    switch(status) {
      case 'on_site': return 'SUR PLACE';
      case 'en_route': return 'EN ROUTE';
      default: return 'DISPONIBLE';
    }
  };

  const getStatusClass = (status: string) => {
    switch(status) {
      case 'on_site': return styles.badgeOnSite;
      case 'en_route': return styles.badgeEnRoute;
      default: return styles.badgeAvailable;
    }
  };

  return (
    <>
      {!audioEnabled && (
        <div className={styles.audioBanner} onClick={onActivateAudio}>
          🔊 APPUYEZ POUR ACTIVER LE SON TACTIQUE
        </div>
      )}
      <header className={styles.header} style={{ marginTop: audioEnabled ? 0 : '44px' }}>
        <div className={styles.headerLeft}>
          <div className={styles.unitName}>{unit?.name || 'UNITÉ SAU'}</div>
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
            <button className={styles.btnInstall} onClick={onInstall}>
              📥 INSTALLER
            </button>
          )}
          <div className={`${styles.connectionStatus} ${socketConnected ? styles.connOnline : styles.connOffline}`}>
            <div className={styles.statusDot}></div>
            <span>{socketConnected ? 'LIAISON OK' : 'RECONNEXION...'}</span>
          </div>
          <button onClick={onLogout} className={styles.btnLogout} title="Quitter">🚪</button>
        </div>
      </header>
    </>
  );
};

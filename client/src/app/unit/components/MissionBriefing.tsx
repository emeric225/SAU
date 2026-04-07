'use client';

import React from 'react';
import styles from '../unit.module.css';

interface MissionBriefingProps {
  mission: any;
  routeData: any;
  onAccept: () => void;
  onRefuse: () => void;
  onViewPhoto: (url: string) => void;
}

export const MissionBriefing: React.FC<MissionBriefingProps> = ({
  mission,
  routeData,
  onAccept,
  onRefuse,
  onViewPhoto
}) => {
  if (!mission) return null;

  return (
    <div className={styles.popup}>
      <div className={styles.popupHeader}>
        <div className={styles.popupAlertDot}></div>
        <h3 className={styles.popupTitle}>NOUVELLE MISSION</h3>
      </div>
      
      <p className={styles.popupType}>{mission.type?.toUpperCase() || 'URGENCE'}</p>

      {mission.photo_url && (
        <div className={styles.missionPhotoThumb} onClick={() => onViewPhoto(mission.photo_url)}>
          <img src={mission.photo_url} alt="Photo Alerte" />
          <div className={styles.photoZoomIcon}>🔍</div>
        </div>
      )}

      <div className={styles.popupDetailsGrid}>
        <div className={styles.popupDetailRow}>
          <span className={styles.popupDetailLabel}>📍 LIEU</span>
          <span>{mission.name || 'ANONYME'}</span>
        </div>
        <div className={styles.popupDetailRow}>
          <span className={styles.popupDetailLabel}>📞 CONTACT</span>
          <a href={`tel:${mission.phone}`} className={styles.popupPhone}>{mission.phone || 'N/A'}</a>
        </div>
        {routeData && (
          <div className={styles.popupDetailRow}>
            <span className={styles.popupDetailLabel}>🗺️ DISTANCE</span>
            <span className={styles.popupEta}>
              {routeData.distanceKm.toFixed(1)} km — {Math.ceil(routeData.durationMin)} min
            </span>
          </div>
        )}
        {mission.notes && (
          <div className={styles.missionNotes}>
            <strong>📋 DÉTAILS OPÉRATIONNELS</strong>
            <p>{mission.notes}</p>
          </div>
        )}
      </div>

      <div className={styles.popupActions}>
        <button onClick={onAccept} className={styles.btnAccept}>
          ✅ ACCEPTER LA MISSION
        </button>
        <button onClick={onRefuse} className={styles.btnRefuse}>
          REPOS
        </button>
      </div>
    </div>
  );
};

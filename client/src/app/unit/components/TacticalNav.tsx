import React from 'react';
import styles from '../unit.module.css';

interface TacticalNavProps {
  status: 'available' | 'en_route' | 'on_site';
  nextInstruction: string | null;
  distanceToInstruction: number;
  missionType: string | null;
  locationName: string | null;
  onActionClick: () => void;
}

export const TacticalNav: React.FC<TacticalNavProps> = ({
  status,
  nextInstruction,
  distanceToInstruction,
  missionType,
  locationName,
  onActionClick
}) => {
  if (status === 'available') return null; // Le bouton "Nouvelle Mission" vient du Briefing

  return (
    <>
      {status === 'en_route' && (
        <div className={styles.directionBanner}>
          <div className={styles.directionDistance}>{distanceToInstruction > 1000 ? (distanceToInstruction/1000).toFixed(1)+' km' : distanceToInstruction+' m'}</div>
          <div className={styles.directionText}>{nextInstruction || 'Proceed to destination'}</div>
        </div>
      )}

      <div className={styles.actionBottomBar}>
        {status === 'en_route' && (
          <button className={`${styles.actionBtn} ${styles.btnOnSite}`} onClick={onActionClick}>
             NOUS SOMMES SUR PLACE
          </button>
        )}
        {status === 'on_site' && (
          <button className={`${styles.actionBtn} ${styles.btnFinish}`} onClick={onActionClick}>
             CLÔTURER DÉPLOIEMENT
          </button>
        )}
      </div>
    </>
  );
};

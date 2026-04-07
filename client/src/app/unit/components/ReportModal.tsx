'use client';

import React from 'react';
import styles from '../unit.module.css';

interface ReportModalProps {
  mission: any;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  mission,
  onSubmit,
  onCancel
}) => {
  if (!mission) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.reportCard}>
        <div className={styles.reportHeader}>
          <h2 className={styles.reportTitle}>BILAN D'INTERVENTION</h2>
          <p className={styles.reportSub}>
            {mission.type?.toUpperCase()} — {mission.name}
          </p>
        </div>
        
        <form className={styles.reportForm} onSubmit={onSubmit}>
          <div className={styles.formGroup}>
            <label>ACTIONS RÉALISÉES</label>
            <textarea 
              name="actions" 
              required 
              placeholder="Décrivez les soins, manœuvres ou moyens engagés..." 
              className={styles.reportTextarea}
            ></textarea>
          </div>
          
          <div className={styles.formGroup}>
            <label>BILAN VICTIMES</label>
            <input 
              type="text" 
              name="victimes" 
              placeholder="Ex: 1 blessé léger, OMI..." 
              className={styles.reportInput} 
            />
          </div>
          
          <div className={styles.formGroup}>
            <label>CONCLUSION DISPATCH</label>
            <select name="conclusion" required className={styles.reportSelect}>
              <option value="success">Mission Terminée avec Succès</option>
              <option value="transferred">Évacué vers CHU / Police</option>
              <option value="false_alarm">Fausse Alerte / Reconnaissance</option>
            </select>
          </div>
          
          <div className={styles.reportActions}>
            <button type="submit" className={styles.btnSubmitReport}>
              TRANSMETTRE LE BILAN
            </button>
            <button type="button" className={styles.btnCancelReport} onClick={onCancel}>
              ANNULER
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

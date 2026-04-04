'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './alert.module.css';

const EMERGENCY_TYPES = [
  { id: 'fire',     label: 'INCENDIE',  icon: '🔥', color: '#e11d48', desc: 'Feu, explosion, fumée' },
  { id: 'medical',  label: 'MÉDICAL',   icon: '🚑', color: '#3b82f6', desc: 'Malaise, accident corporel' },
  { id: 'accident', label: 'ACCIDENT',  icon: '🚗', color: '#f59e0b', desc: 'Collision, carambolage' },
  { id: 'security', label: 'SÉCURITÉ', icon: '👮', color: '#8b5cf6', desc: 'Agression, vol, menace' },
];

export default function AlertPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', notes: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("Géolocalisation non supportée par votre navigateur.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocationError("Position GPS non disponible. Veuillez autoriser la géolocalisation."),
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const startLocationRequest = () => {
    requestLocation();
    setStep(1);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Limit photo size for performance
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo trop volumineuse (max 5 Mo).");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!location || !selectedType || !formData.phone || !formData.name) {
      setError("Veuillez remplir tous les champs obligatoires (*)");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          type: selectedType,
          lat: location.lat,
          lng: location.lng,
          photo_url: photo
        }),
      });
      if (res.ok) {
        setStep(3);
      } else {
        throw new Error("Erreur de serveur");
      }
    } catch {
      setError("Impossible d'envoyer l'alerte. Vérifiez votre connexion et réessayez.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 0) {
    return (
      <div className={styles.permissionScreen}>
        <div className={styles.permissionIcon}>📍</div>
        <h2 className={styles.permissionTitle}>LOCALISATION REQUISE</h2>
        <p className={styles.permissionText}>
          Pour un déploiement précis des secours, nous avons besoin d'accéder à votre position GPS en temps réel.
        </p>
        <button onClick={startLocationRequest} className={styles.btnPermission}>
          AUTORISER ET CONTINUER
        </button>
        <p style={{ color: '#475569', fontSize: '12px' }}>Vos données sont traitées uniquement pour cette urgence.</p>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className={styles.successScreen}>
        <div className={styles.successIcon}>✓</div>
        <h2>ALERTE ENVOYÉE</h2>
        <p>Les secours ont été notifiés et sont en route vers votre position.</p>
        <div className={styles.infoBox}>
          📍 Lat: {location?.lat.toFixed(5)}, Lng: {location?.lng.toFixed(5)}
        </div>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Restez en ligne et en sécurité.</p>
        <button onClick={() => router.push('/')} className={styles.closeBtn}>Retour à l'accueil</button>
      </div>
    );
  }

  const selectedTypeInfo = EMERGENCY_TYPES.find(t => t.id === selectedType);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button onClick={() => step === 2 ? setStep(1) : router.back()} className={styles.backBtn}>←</button>
        <h1>{step === 1 ? "Type d'urgence" : "Vos informations"}</h1>
        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${step >= 1 ? styles.stepActive : ''}`} />
          <div className={styles.stepLine} />
          <div className={`${styles.stepDot} ${step >= 2 ? styles.stepActive : ''}`} />
        </div>
      </header>

      {error && <div className={styles.errorBanner}>⚠️ {error}</div>}

      <div className={styles.content}>
        {step === 1 && (
          <div className={styles.typeGrid}>
            <p className={styles.stepHint}>Sélectionnez le type d'urgence</p>
            {EMERGENCY_TYPES.map(type => (
              <button
                key={type.id}
                className={`${styles.typeBtn} ${selectedType === type.id ? styles.activeType : ''}`}
                style={selectedType === type.id ? { borderColor: type.color, background: `${type.color}22` } : {}}
                onClick={() => { setSelectedType(type.id); setStep(2); }}
              >
                <span className={styles.typeIcon}>{type.icon}</span>
                <div className={styles.typeInfo}>
                  <span className={styles.typeLabel}>{type.label}</span>
                  <span className={styles.typeDesc}>{type.desc}</span>
                </div>
                <span className={styles.typeArrow}>→</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className={styles.formSection}>
            {selectedTypeInfo && (
              <div className={styles.selectedTypeBadge} style={{ borderColor: selectedTypeInfo.color, background: `${selectedTypeInfo.color}22` }}>
                {selectedTypeInfo.icon} {selectedTypeInfo.label}
              </div>
            )}

            <div className={styles.inputGroup}>
              <label>Nom complet <span style={{color:'#e11d48'}}>*</span></label>
              <input
                type="text"
                placeholder="Ex: Jean Kouassi"
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Numéro de téléphone <span style={{color:'#e11d48'}}>*</span></label>
              <input
                type="tel"
                placeholder="Ex: 0102030405"
                required
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Détails de l'alerte <span style={{color:'#e11d48'}}>*</span></label>
              <textarea
                placeholder="Décrivez brièvement la situation..."
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                required
              />
            </div>

            <div className={styles.inputGroup}>
              <label>Photo (optionnel)</label>
              <div className={styles.photoUpload}>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} id="photo-input" hidden />
                <label htmlFor="photo-input" className={styles.photoLabel}>
                  {photo ? '📸 Photo capturée — Modifier' : '📷 Prendre / Ajouter une photo'}
                </label>
                {photo && (
                  <div className={styles.photoPreviewWrapper}>
                    <img src={photo} alt="Preview" className={styles.photoPreview} />
                    <button onClick={() => setPhoto(null)} className={styles.removePhoto}>×</button>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.locationStatus}>
              {location
                ? <><span style={{color:'#10b981'}}>✓</span> Position GPS acquise</>
                : locationError
                  ? <><span style={{color:'#e11d48'}}>✗</span> {locationError} — <button onClick={requestLocation} style={{color:'#3b82f6',background:'none',border:'none',cursor:'pointer',fontWeight:700}}>Réessayer</button></>
                  : <><span style={{color:'#f59e0b'}}>⏳</span> Acquisition GPS en cours...</>
              }
            </div>

            <button
              className={`btn-sos ${isSubmitting || !location || !formData.phone || !formData.name || !formData.notes ? styles.disabled : ''}`}
              onClick={handleSubmit}
              disabled={isSubmitting || !location || !formData.phone || !formData.name || !formData.notes}
            >
              {isSubmitting ? '⏳ ENVOI EN COURS...' : '🚨 CONFIRMER L\'ALERTE'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './alert.module.css';

const EMERGENCY_TYPES = [
  { id: 'fire',     label: 'INCENDIE',   icon: '🔥', color: '#e11d48', desc: 'Feu, explosion, fumée toxique' },
  { id: 'medical',  label: 'MÉDICAL',    icon: '🚑', color: '#3b82f6', desc: 'Malaise, accident corporel, AVC' },
  { id: 'accident', label: 'ACCIDENT',   icon: '🚗', color: '#f59e0b', desc: 'Collision véhicule, carambolage' },
  { id: 'security', label: 'SÉCURITÉ',  icon: '👮', color: '#8b5cf6', desc: 'Agression, vol, menace armée' },
];

export default function AlertPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', notes: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

  // Acquisition GPS continue (haute précision)
  const startGPS = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError('Géolocalisation non disponible sur cet appareil.');
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationAccuracy(Math.round(pos.coords.accuracy));
      },
      () => setLocationError('Position GPS non disponible. Autorisez la géolocalisation.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  };

  const requestLocation = () => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setLocation(null);
    setLocationError(null);
    startGPS();
  };

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setError(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height = Math.round(height * (MAX_WIDTH / width)); width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width = Math.round(width * (MAX_HEIGHT / height)); height = MAX_HEIGHT; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setPhoto(dataUrl);
        } else {
          setPhoto(reader.result as string);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!location || !selectedType || !formData.phone || !formData.name || !formData.notes) {
      setError('Veuillez remplir tous les champs obligatoires.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, type: selectedType, lat: location.lat, lng: location.lng, photo_url: photo }),
      });
      if (res.ok) { setStep(3); }
      else { throw new Error('Erreur serveur'); }
    } catch {
      setError("Impossible d'envoyer l'alerte. Vérifiez votre connexion.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Écran d'autorisation GPS ─────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className={styles.permissionScreen}>
        <div className={styles.permissionIcon}>📍</div>
        <h2 className={styles.permissionTitle}>LOCALISATION REQUISE</h2>
        <p className={styles.permissionText}>
          Pour déployer les secours avec précision, nous avons besoin de votre position GPS exacte.
        </p>
        <button
          onClick={() => { startGPS(); setStep(1); }}
          className={styles.btnPermission}
        >
          AUTORISER ET CONTINUER →
        </button>
        <p style={{ color: '#475569', fontSize: 12, marginTop: 8 }}>
          Vos données ne sont utilisées que pour cette urgence.
        </p>
      </div>
    );
  }

  // ─── Écran de confirmation ─────────────────────────────────────────────────
  if (step === 3) {
    return (
      <div className={styles.successScreen}>
        <div className={styles.successIcon}>✓</div>
        <h2>ALERTE ENVOYÉE</h2>
        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
          Les secours ont été notifiés et se dirigent vers votre position.
          <br />Restez en ligne et en sécurité.
        </p>
        <div className={styles.infoBox}>
          📍 {location?.lat.toFixed(5)}, {location?.lng.toFixed(5)}<br />
          🎯 Précision GPS : {locationAccuracy ?? '—'} m
        </div>
        <button onClick={() => router.push('/')} className={styles.closeBtn}>
          Retour à l'accueil
        </button>
      </div>
    );
  }

  const typeInfo = EMERGENCY_TYPES.find(t => t.id === selectedType);
  const canConfirm = !!(location && formData.name && formData.phone && formData.notes && selectedType);

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <button
          onClick={() => (step === 2 ? setStep(1) : router.back())}
          className={styles.backBtn}
        >←</button>
        <h1>{step === 1 ? "Type d'urgence" : 'Vos informations'}</h1>
        <div className={styles.stepIndicator}>
          <div className={`${styles.stepDot} ${step >= 1 ? styles.stepActive : ''}`} />
          <div className={styles.stepLine} />
          <div className={`${styles.stepDot} ${step >= 2 ? styles.stepActive : ''}`} />
        </div>
      </header>

      {/* ── Erreur ── */}
      {error && <div className={styles.errorBanner}>⚠️ {error}</div>}

      <div className={styles.content}>

        {/* ── Étape 1 : Type d'urgence ── */}
        {step === 1 && (
          <div className={styles.typeGrid}>
            <p className={styles.stepHint}>Sélectionnez le type d&apos;urgence</p>
            {EMERGENCY_TYPES.map(type => (
              <button
                key={type.id}
                className={`${styles.typeBtn} ${selectedType === type.id ? styles.activeType : ''}`}
                style={selectedType === type.id ? { borderColor: type.color, background: `${type.color}18` } : {}}
                onClick={() => { setSelectedType(type.id); setStep(2); }}
              >
                <span className={styles.typeIcon}>{type.icon}</span>
                <div className={styles.typeInfo}>
                  <span className={styles.typeLabel} style={selectedType === type.id ? { color: type.color } : {}}>
                    {type.label}
                  </span>
                  <span className={styles.typeDesc}>{type.desc}</span>
                </div>
                <span className={styles.typeArrow}>→</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Étape 2 : Formulaire ── */}
        {step === 2 && (
          <div className={styles.formSection}>
            {/* Badge du type sélectionné */}
            {typeInfo && (
              <div
                className={styles.selectedTypeBadge}
                style={{ borderColor: typeInfo.color, background: `${typeInfo.color}18`, color: typeInfo.color }}
              >
                {typeInfo.icon} {typeInfo.label}
                <button
                  onClick={() => setStep(1)}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.7 }}
                >
                  Changer
                </button>
              </div>
            )}

            {/* Nom */}
            <div className={styles.inputGroup}>
              <label>Nom complet <span style={{ color: '#e11d48' }}>*</span></label>
              <input
                type="text"
                placeholder="Ex: Jean Kouassi"
                autoComplete="name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Téléphone */}
            <div className={styles.inputGroup}>
              <label>Numéro de téléphone <span style={{ color: '#e11d48' }}>*</span></label>
              <input
                type="tel"
                placeholder="Ex: 07 00 00 00 00"
                autoComplete="tel"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            {/* Description */}
            <div className={styles.inputGroup}>
              <label>Description de la situation <span style={{ color: '#e11d48' }}>*</span></label>
              <textarea
                placeholder="Décrivez brièvement ce qui se passe (nb de personnes, gravité, danger...)"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                required
              />
            </div>

            {/* Photo */}
            <div className={styles.inputGroup}>
              <label>Photo de la scène <span style={{ color: '#64748b', fontWeight: 400 }}>(optionnel)</span></label>
              <div className={styles.photoUpload}>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} id="photo-input" hidden />
                <label htmlFor="photo-input" className={styles.photoLabel}>
                  {photo ? '📸 Photo capturée — Appuyer pour changer' : '📷 Prendre / Ajouter une photo'}
                </label>
                {photo && (
                  <div className={styles.photoPreviewWrapper}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo} alt="Aperçu" className={styles.photoPreview} />
                    <button onClick={() => setPhoto(null)} className={styles.removePhoto}>×</button>
                  </div>
                )}
              </div>
            </div>

            {/* Statut GPS */}
            <div className={styles.locationStatus}>
              {location ? (
                <>
                  <span style={{ color: '#10b981', fontSize: 18 }}>●</span>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>GPS acquis</span>
                  {locationAccuracy && <span style={{ color: '#64748b', fontSize: 12 }}>— précision ±{locationAccuracy} m</span>}
                </>
              ) : locationError ? (
                <>
                  <span style={{ color: '#e11d48', fontSize: 18 }}>✗</span>
                  <span style={{ color: '#e11d48', fontWeight: 600 }}>{locationError}</span>
                  <button
                    onClick={requestLocation}
                    style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, marginLeft: 'auto' }}
                  >
                    Réessayer
                  </button>
                </>
              ) : (
                <>
                  <span style={{ color: '#f59e0b', fontSize: 18, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⊙</span>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>Acquisition GPS en cours…</span>
                </>
              )}
            </div>

            {/* Bouton confirmer */}
            <button
              style={{
                width: '100%',
                padding: '22px',
                borderRadius: 20,
                border: 'none',
                background: canConfirm && !isSubmitting ? 'linear-gradient(135deg, #e11d48, #be123c)' : 'rgba(255,255,255,0.08)',
                color: canConfirm && !isSubmitting ? '#fff' : '#64748b',
                fontWeight: 900,
                fontSize: 18,
                letterSpacing: 1,
                cursor: canConfirm && !isSubmitting ? 'pointer' : 'not-allowed',
                boxShadow: canConfirm && !isSubmitting ? '0 12px 30px rgba(225,29,72,0.4)' : 'none',
                transition: 'all 0.2s',
              }}
              onClick={handleSubmit}
              disabled={!canConfirm || isSubmitting}
            >
              {isSubmitting ? '⏳ ENVOI EN COURS...' : '🚨 CONFIRMER L\'ALERTE'}
            </button>

            {!canConfirm && !isSubmitting && (
              <p style={{ textAlign: 'center', color: '#475569', fontSize: 12 }}>
                Remplissez tous les champs et attendez le GPS
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './alert.module.css';

const EMERGENCY_TYPES = [
  { id: 'fire', label: 'INCENDIE', icon: '🔥' },
  { id: 'medical', label: 'MÉDICAL', icon: '🚑' },
  { id: 'accident', label: 'ACCIDENT', icon: '🚗' },
  { id: 'security', label: 'SÉCURITÉ', icon: '👮' },
];

export default function AlertPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '' });
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => setError("Veuillez autoriser le GPS pour envoyer une alerte.")
      );
    }
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!location || !selectedType || !formData.phone) return;
    
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
    } catch (err) {
      setError("Impossible d'envoyer l'alerte. Veuillez réessayer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 3) {
    return (
      <div className={styles.successScreen}>
        <div className={styles.successIcon}>✓</div>
        <h2>ALERTE ENVOYÉE</h2>
        <p>Les secours ont été notifiés et sont en route.</p>
        <div className={styles.infoBox}>
          Position : {location?.lat.toFixed(4)}, {location?.lng.toFixed(4)}
        </div>
        <button onClick={() => router.push('/')} className={styles.closeBtn}>Fermer</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button onClick={() => router.back()} className={styles.backBtn}>←</button>
        <h1>Nouvelle Alerte</h1>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.content}>
        {step === 1 && (
          <div className={styles.typeGrid}>
            <h3>Type d'urgence</h3>
            {EMERGENCY_TYPES.map(type => (
              <button 
                key={type.id} 
                className={`${styles.typeBtn} ${selectedType === type.id ? styles.activeType : ''}`}
                onClick={() => { setSelectedType(type.id); setStep(2); }}
              >
                <span className={styles.typeIcon}>{type.icon}</span>
                <span className={styles.typeLabel}>{type.label}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className={styles.formSection}>
            <h3>Informations de contact</h3>
            <div className={styles.inputGroup}>
              <label>Nom complet</label>
              <input 
                type="text" 
                placeholder="Ex: Jean Kouassi"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className={styles.inputGroup}>
              <label>Numéro de téléphone *</label>
              <input 
                type="tel" 
                placeholder="Ex: 0102030405"
                required
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
              />
            </div>
            
            <div className={styles.inputGroup}>
              <label>Photo (Optionnel)</label>
              <div className={styles.photoUpload}>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handlePhotoChange}
                  id="photo-input"
                  hidden
                />
                <label htmlFor="photo-input" className={styles.photoLabel}>
                  {photo ? '📸 Photo capturée' : '📷 Ajouter une photo'}
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
              {location ? '📍 Position GPS acquise' : '⏳ Acquisition GPS...'}
            </div>

            <button 
              className={`btn-sos ${isSubmitting || !location || !formData.phone ? styles.disabled : ''}`}
              onClick={handleSubmit}
              disabled={isSubmitting || !location || !formData.phone}
            >
              {isSubmitting ? 'ENVOI...' : 'CONFIRMER L\'ALERTE'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [stations, setStations] = useState<any[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/stations')
      .then(r => r.json())
      .then(data => setStations(data))
      .catch(err => console.error("Error fetching stations:", err));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStation) return setError('Veuillez choisir une caserne');

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId: selectedStation })
      });

      const data = await res.json();
      if (data.success) {
        localStorage.setItem('sau_station', JSON.stringify(data.station));
        router.push('/dashboard');
      } else {
        setError(data.error || 'Erreur de connexion');
      }
    } catch (err) {
      setError('Erreur réseau');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <div className={styles.logo}>SAU</div>
        <h1>ACCÈS OPÉRATIONNEL</h1>
        <p>Sélectionnez votre caserne pour accéder au QG</p>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleLogin}>
          <div className={styles.field}>
            <label>Caserne / Unité</label>
            <select 
              value={selectedStation} 
              onChange={(e) => setSelectedStation(e.target.value)}
              className={styles.select}
            >
              <option value="">-- Choisir une caserne --</option>
              <option value="admin">QG Central (Administrateur)</option>
              {stations.map(s => (
                <option key={s.id} value={s.id}>{s.name} - {s.city}</option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={loading} className={styles.loginBtn}>
            {loading ? 'CONNEXION...' : 'SE CONNECTER'}
          </button>
        </form>

        <div className={styles.footer}>
          Système d'Alerte d'Urgence v2.0
        </div>
      </div>
    </div>
  );
}

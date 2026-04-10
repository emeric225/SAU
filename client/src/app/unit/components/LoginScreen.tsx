'use client';
import React from 'react';

interface LoginScreenProps {
  onLogin: (id: string) => void;
  error: string;
  loading: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, error, loading }) => {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const id = (e.currentTarget.elements.namedItem('uid') as HTMLInputElement).value.trim();
    if (id) onLogin(id);
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(145deg, #030712 0%, #0a0f1e 50%, #020817 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div style={{
          fontSize: 48, fontWeight: 900, letterSpacing: 6,
          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>SAU</div>
        <div style={{ fontSize: 11, letterSpacing: 4, color: '#475569', marginTop: 4 }}>
          SYSTÈME D'ASSISTANCE D'URGENCE
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 24, padding: 32,
        backdropFilter: 'blur(20px)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px', letterSpacing: 1 }}>
          IDENTIFICATION TACTIQUE
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 28px' }}>
          Saisissez le code d'identification de votre unité
        </p>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 12, padding: '10px 14px', marginBottom: 20,
            color: '#f87171', fontSize: 13, fontWeight: 600,
          }}>
            ⚠ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            name="uid"
            type="text"
            placeholder="Ex : AMB-01"
            autoComplete="off"
            autoCapitalize="characters"
            required
            style={{
              width: '100%', padding: '18px 20px', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 14, color: '#f1f5f9', fontSize: 20,
              fontWeight: 700, letterSpacing: 3, textAlign: 'center',
              outline: 'none', WebkitAppearance: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '20px',
              background: loading ? 'rgba(59,130,246,0.4)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: '#fff', border: 'none', borderRadius: 16,
              fontSize: 18, fontWeight: 900, letterSpacing: 2,
              cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : '0 8px 32px rgba(37,99,235,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {loading ? 'CONNEXION…' : 'CONNEXION'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 32, fontSize: 11, color: '#334155', letterSpacing: 2 }}>
        OPÉRATIONNEL · CONFIDENTIEL
      </div>
    </div>
  );
};

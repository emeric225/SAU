'use client';
import React from 'react';

interface MissionBriefingProps {
  mission: any;
  routeData: any;
  onAccept: () => void;
  onRefuse: () => void;
  onViewPhoto: (url: string) => void;
}

function formatCoords(lat: number | null, lng: number | null) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;
  return `${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`;
}

const TYPE_COLORS: Record<string, string> = {
  fire:     '#e11d48',
  medical:  '#3b82f6',
  accident: '#f59e0b',
  security: '#8b5cf6',
};

const TYPE_ICONS: Record<string, string> = {
  fire: '🔥', medical: '🚑', accident: '🚗', security: '👮',
};

export const MissionBriefing: React.FC<MissionBriefingProps> = ({
  mission, routeData, onAccept, onRefuse, onViewPhoto,
}) => {
  if (!mission) return null;

  const lat  = Number(mission.lat ?? mission.latitude);
  const lng  = Number(mission.lng ?? mission.longitude);
  const coords = formatCoords(lat, lng);
  const typeColor = TYPE_COLORS[mission.type] || '#3b82f6';
  const typeIcon  = TYPE_ICONS[mission.type]  || '🚨';
  const hasValidCoords = coords !== null;

  return (
    <div style={{
      width: '100%',
      background: 'linear-gradient(180deg, #0d1426 0%, #0a0f1e 100%)',
      borderTop: `3px solid ${typeColor}`,
      borderRadius: '24px 24px 0 0',
      padding: '24px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Alert dot + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 12, height: 12, borderRadius: '50%',
          background: typeColor,
          boxShadow: `0 0 12px ${typeColor}`,
          animation: 'pulse 1s ease-in-out infinite',
        }} />
        <span style={{ fontSize: 11, letterSpacing: 3, color: '#64748b', fontWeight: 700 }}>
          NOUVELLE MISSION
        </span>
      </div>

      {/* Type badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 99,
        background: `${typeColor}22`, border: `1px solid ${typeColor}55`,
        color: typeColor, fontSize: 16, fontWeight: 800, letterSpacing: 1,
        marginBottom: 20,
      }}>
        {typeIcon} {mission.type?.toUpperCase() || 'URGENCE'}
      </div>

      {/* Photo */}
      {mission.photo_url && (
        <div
          onClick={() => onViewPhoto(mission.photo_url)}
          style={{
            position: 'relative', borderRadius: 16, overflow: 'hidden',
            height: 140, marginBottom: 16, cursor: 'pointer',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mission.photo_url} alt="Scène" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🔍</div>
        </div>
      )}

      {/* Detail rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        
        {/* GPS Position — CRITICAL */}
        <div style={{
          padding: '12px 14px', borderRadius: 14,
          background: hasValidCoords ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${hasValidCoords ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
            📍 POSITION GPS
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: hasValidCoords ? '#34d399' : '#f87171', letterSpacing: 0.5 }}>
            {hasValidCoords ? coords : '⚠ COORDONNÉES MANQUANTES'}
          </div>
        </div>

        {/* Caller info */}
        <div style={{ padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>👤 APPELANT</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{mission.name || 'ANONYME'}</div>
        </div>

        {/* Phone */}
        {mission.phone && (
          <a
            href={`tel:${mission.phone}`}
            style={{
              display: 'block', padding: '10px 14px', borderRadius: 14, textDecoration: 'none',
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)',
            }}
          >
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>📞 CONTACT</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#60a5fa' }}>{mission.phone}</div>
          </a>
        )}

        {/* Route ETA */}
        {routeData && (
          <div style={{ padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>🗺️ ITINÉRAIRE</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
              {routeData.distanceKm?.toFixed(1)} km — {Math.ceil(routeData.durationMin)} min
            </div>
          </div>
        )}

        {/* Notes */}
        {mission.notes && (
          <div style={{ padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>📋 DÉTAILS</div>
            <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>{mission.notes}</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onAccept}
          style={{
            width: '100%', padding: '20px', border: 'none', borderRadius: 18,
            background: `linear-gradient(135deg, ${typeColor}, ${typeColor}bb)`,
            color: '#fff', fontSize: 18, fontWeight: 900, letterSpacing: 1,
            cursor: 'pointer', boxShadow: `0 8px 32px ${typeColor}55`,
          }}
        >
          🚀 DÉMARRER L'INTERVENTION
        </button>
        <button
          onClick={onRefuse}
          style={{
            width: '100%', padding: '14px', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 14, background: 'rgba(255,255,255,0.04)',
            color: '#64748b', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          IGNORER / DÉCLINER
        </button>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
};

'use client';
import React from 'react';

type MissionStatus = 'en_route' | 'on_site';

interface GuidanceBannerProps {
  status: MissionStatus;
  instruction: string;
  distanceM: number;
  missionType?: string;
}

function formatDist(m: number) {
  if (m <= 0) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export const GuidanceBanner: React.FC<GuidanceBannerProps> = ({
  status, instruction, distanceM, missionType,
}) => {
  const isEnRoute = status === 'en_route';
  const dist = formatDist(distanceM);

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0,
      zIndex: 40,
      background: isEnRoute
        ? 'linear-gradient(180deg, rgba(10,18,35,0.97) 0%, rgba(10,18,35,0.85) 100%)'
        : 'linear-gradient(180deg, rgba(5,32,5,0.97) 0%, rgba(5,32,5,0.85) 100%)',
      borderBottom: isEnRoute ? '2px solid rgba(59,130,246,0.5)' : '2px solid rgba(16,185,129,0.5)',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    }}>
      {/* Mission type tag */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 16px 0',
        fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#64748b',
      }}>
        <span>{isEnRoute ? '🔵 EN ROUTE' : '🟢 SUR PLACE'}</span>
        {missionType && <span style={{ color: '#f59e0b' }}>{missionType.toUpperCase()}</span>}
      </div>

      {/* Main instruction */}
      <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {dist && (
          <div style={{
            minWidth: 72, textAlign: 'center',
            fontSize: 22, fontWeight: 900,
            color: isEnRoute ? '#60a5fa' : '#34d399',
            lineHeight: 1,
          }}>
            {dist}
          </div>
        )}
        <div style={{ flex: 1,
          fontSize: dist ? 17 : 18,
          fontWeight: 700,
          color: '#f1f5f9',
          lineHeight: 1.3,
        }}>
          {instruction || (isEnRoute ? 'Calcul de l\'itinéraire…' : 'En attente d\'actions')}
        </div>
      </div>

      {/* Progress glow bar */}
      <div style={{
        height: 3,
        background: isEnRoute
          ? 'linear-gradient(90deg, #1d4ed8, #3b82f6, #60a5fa)'
          : 'linear-gradient(90deg, #059669, #10b981, #34d399)',
        margin: '6px 0 0',
      }} />
    </div>
  );
};

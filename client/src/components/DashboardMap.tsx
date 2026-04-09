'use client';

import React, { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker, Popup as MapLibrePopup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface DashboardMapProps {
  stations?: any[];
  alerts?: any[];
  units?: any[];
  selectedAlert?: any | null;
  onAlertClick?: (alert: any) => void;
}

const UNIT_ICONS: Record<string, string> = {
  fire: '🚒', ambulance: '🚑', moto: '🏍️', command: '🚙', tanker: '🚚', default: '🚗'
};
const ALERT_COLORS: Record<string, string> = {
  fire: '#e11d48', medical: '#3b82f6', accident: '#f59e0b', security: '#8b5cf6', default: '#ef4444'
};

export default function DashboardMap({ stations = [], alerts = [], units = [], selectedAlert = null, onAlertClick }: DashboardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stationMarkersRef = useRef<Record<string, MapLibreMarker>>({});
  const alertMarkersRef = useRef<Record<string, { marker: MapLibreMarker; popup: MapLibrePopup }>>({});
  const unitMarkersRef = useRef<Record<string, MapLibreMarker>>({});

  // ─── Init carte ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    let mapInstance: MapLibreMap;

    const init = async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      mapInstance = new maplibregl.Map({
        container: containerRef.current!,
        style: {
          version: 8,
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors © CARTO',
            },
          },
          layers: [{ id: 'base', type: 'raster', source: 'carto-dark' }],
        },
        center: [-4.0268, 5.3365], // Abidjan
        zoom: 11,
        attributionControl: false,
      });
      mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
      mapInstance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
      mapRef.current = mapInstance;
    };

    init();
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      stationMarkersRef.current = {};
      alertMarkersRef.current = {};
      unitMarkersRef.current = {};
    };
  }, []);

  // ─── Marqueurs Stations ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === 'undefined') return;

    const syncStations = async () => {
      if (!map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      // Supprimer les stations qui n'existent plus
      const stationIds = new Set(stations.map((s: any) => s.id));
      Object.keys(stationMarkersRef.current).forEach(id => {
        if (!stationIds.has(id)) {
          stationMarkersRef.current[id].remove();
          delete stationMarkersRef.current[id];
        }
      });

      stations.forEach((station: any) => {
        const sLat = Number(station.lat ?? station.latitude ?? station.location?.lat);
        const sLng = Number(station.lng ?? station.longitude ?? station.location?.lng);
        if (isNaN(sLat) || isNaN(sLng) || sLat === 0) return;

        if (stationMarkersRef.current[station.id]) {
          stationMarkersRef.current[station.id].setLngLat([sLng, sLat]);
          return;
        }
        const el = document.createElement('div');
        el.style.cssText = `
          background: #1e3a5f;
          width: 40px; height: 40px;
          border-radius: 12px;
          border: 2.5px solid #3b82f6;
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
          box-shadow: 0 4px 16px rgba(59,130,246,0.5);
          cursor: pointer;
        `;
        el.innerHTML = '🏠';
        el.title = station.name;

        const popup = new maplibregl.Popup({ offset: 25, closeButton: false })
          .setHTML(`
            <div style="font-family:system-ui;background:#0d1117;padding:12px;border-radius:10px;border:1px solid rgba(59,130,246,0.4);min-width:160px;">
              <strong style="color:#3b82f6;font-size:14px;">${station.name}</strong><br/>
              <span style="color:#94a3b8;font-size:12px;">${station.city || ''}</span><br/>
              <span style="background:${station.status === 'active' ? '#10b981' : '#f59e0b'}22;color:${station.status === 'active' ? '#10b981' : '#f59e0b'};padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;margin-top:4px;display:inline-block;">
                ${station.status === 'active' ? 'EN LIGNE' : 'INDISPONIBLE'}
              </span>
            </div>
          `);

        stationMarkersRef.current[station.id] = new maplibregl.Marker({ element: el })
          .setLngLat([sLng, sLat])
          .setPopup(popup)
          .addTo(map);
      });
    };

    if (!map.isStyleLoaded()) { map.once('style.load', syncStations); } else { syncStations(); }
  }, [stations]);

  // ─── Marqueurs Alertes ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === 'undefined') return;

    const syncAlerts = async () => {
      if (!map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      const alertIds = new Set(alerts.map((a: any) => a.id));
      Object.keys(alertMarkersRef.current).forEach(id => {
        if (!alertIds.has(id)) {
          alertMarkersRef.current[id].marker.remove();
          delete alertMarkersRef.current[id];
        }
      });

      alerts.forEach((alert: any) => {
        const aLat = Number(alert.lat ?? alert.latitude ?? alert.location?.lat);
        const aLng = Number(alert.lng ?? alert.longitude ?? alert.location?.lng);
        if (isNaN(aLat) || isNaN(aLng) || aLat === 0) return;

        const color = ALERT_COLORS[alert.type] || ALERT_COLORS.default;
        const isSelected = selectedAlert?.id === alert.id;

        if (alertMarkersRef.current[alert.id]) {
          alertMarkersRef.current[alert.id].marker.setLngLat([aLng, aLat]);
          const el = alertMarkersRef.current[alert.id].marker.getElement();
          el.style.transform = isSelected ? 'scale(1.3)' : 'scale(1)';
          return;
        }

        const el = document.createElement('div');
        el.style.cssText = `
          width: 44px; height: 44px;
          border-radius: 50%;
          border: 3px solid ${color};
          background: ${color}33;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px;
          box-shadow: 0 0 20px ${color}80;
          cursor: pointer;
          transition: transform 0.2s;
          animation: alertPulse 1.5s infinite;
        `;
        // CSS animation inline via style tag
        if (!document.getElementById('sau-alert-anim')) {
          const style = document.createElement('style');
          style.id = 'sau-alert-anim';
          style.textContent = `@keyframes alertPulse { 0%,100%{box-shadow:0 0 20px ${color}80} 50%{box-shadow:0 0 40px ${color}} }`;
          document.head.appendChild(style);
        }

        const icons: Record<string, string> = { fire: '🔥', medical: '🚑', accident: '🚗', security: '👮' };
        el.innerHTML = icons[alert.type] || '🚨';
        el.addEventListener('click', () => onAlertClick?.(alert));

        const popup = new maplibregl.Popup({ offset: 30, closeButton: false })
          .setHTML(`
            <div style="font-family:system-ui;background:#0d1117;padding:14px;border-radius:10px;border:1px solid ${color}66;min-width:180px;">
              <strong style="color:${color};font-size:13px;letter-spacing:1px;">${alert.type?.toUpperCase()} — SOS</strong><br/>
              <span style="color:#f8fafc;font-size:14px;font-weight:700;">${alert.name || 'Appelant Inconnu'}</span><br/>
              <span style="color:#94a3b8;font-size:12px;">${alert.phone || ''}</span><br/>
              <span style="color:#64748b;font-size:11px;margin-top:4px;display:block;">${alert.notes ? alert.notes.slice(0, 60) + (alert.notes.length > 60 ? '...' : '') : ''}</span>
            </div>
          `);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([aLng, aLat])
          .setPopup(popup)
          .addTo(map);

        alertMarkersRef.current[alert.id] = { marker, popup };
      });
    };

    if (!map.isStyleLoaded()) { map.once('style.load', syncAlerts); } else { syncAlerts(); }
  }, [alerts, selectedAlert, onAlertClick]);

  // ─── Marqueurs Unités ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === 'undefined') return;

    const syncUnits = async () => {
      if (!map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      const unitIds = new Set(units.map((u: any) => u.id));
      Object.keys(unitMarkersRef.current).forEach(id => {
        if (!unitIds.has(id)) {
          unitMarkersRef.current[id].remove();
          delete unitMarkersRef.current[id];
        }
      });

      units.forEach((unit: any) => {
        const uLat = Number(unit.lat ?? unit.latitude ?? unit.location?.lat);
        const uLng = Number(unit.lng ?? unit.longitude ?? unit.location?.lng);
        if (isNaN(uLat) || isNaN(uLng) || uLat === 0) return;

        const statusColor = unit.status === 'available' ? '#10b981' : unit.status === 'en_route' ? '#f59e0b' : '#e11d48';

        if (unitMarkersRef.current[unit.id]) {
          unitMarkersRef.current[unit.id].setLngLat([uLng, uLat]);
          return;
        }

        const el = document.createElement('div');
        el.style.cssText = `
          width: 38px; height: 38px;
          border-radius: 10px;
          background: ${statusColor}22;
          border: 2px solid ${statusColor};
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
          box-shadow: 0 4px 12px ${statusColor}60;
          cursor: pointer;
        `;
        el.innerHTML = UNIT_ICONS[unit.type] || UNIT_ICONS.default;
        el.title = `${unit.name} — ${unit.status}`;

        unitMarkersRef.current[unit.id] = new maplibregl.Marker({ element: el })
          .setLngLat([uLng, uLat])
          .addTo(map);
      });
    };

    if (!map.isStyleLoaded()) { map.once('style.load', syncUnits); } else { syncUnits(); }
  }, [units]);

  // ─── Focus sur l'alerte sélectionnée ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    
    // Casting et fallback pour l'alerte sélectionnée
    const cLat = Number(selectedAlert?.lat ?? selectedAlert?.latitude ?? selectedAlert?.location?.lat);
    const cLng = Number(selectedAlert?.lng ?? selectedAlert?.longitude ?? selectedAlert?.location?.lng);
    
    if (!map || isNaN(cLat) || isNaN(cLng) || cLat === 0) return;
    map.flyTo({ center: [cLng, cLat], zoom: 15, duration: 1000 });
    // Ouvrir le popup de l'alerte sélectionnée
    setTimeout(() => {
      const entry = alertMarkersRef.current[selectedAlert.id];
      if (entry) entry.marker.togglePopup();
    }, 1100);
  }, [selectedAlert?.id]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        inset: 0,
        background: '#05070a',
      }}
    />
  );
}

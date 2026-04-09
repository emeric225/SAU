'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

const ROUTE_SRC = 'sau-route-src';
const LAYER_CASING = 'sau-route-casing';
const LAYER_LINE = 'sau-route-line';

export interface MapProps {
  center?: [number, number];
  stations?: any[];
  alerts?: any[];
  units?: any[];
  selectedAlert?: any;
  navigationActive?: boolean;
  speed?: number;
  heading?: number;
  onRouteDataReady?: (data: { distanceKm: number; durationMin: number }) => void;
}

// ─── Géomathématiques ──────────────────────────────────────────────────────────
function toRad(d: number) { return d * Math.PI / 180; }
function toDeg(r: number) { return r * 180 / Math.PI; }

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a: [number, number], b: [number, number]): number {
  const lat1 = toRad(a[0]), lat2 = toRad(b[0]), dLon = toRad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function snapPoint(pos: [number, number], coords: [number, number][]): [number, number] {
  let best: [number, number] = pos;
  let minD = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = [coords[i][0], coords[i][1]];
    const [x2, y2] = [coords[i + 1][0], coords[i + 1][1]];
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) continue;
    const t = Math.max(0, Math.min(1, ((pos[0] - x1) * dx + (pos[1] - y1) * dy) / (dx * dx + dy * dy)));
    const snap: [number, number] = [x1 + t * dx, y1 + t * dy];
    const d = haversine(pos, snap);
    if (d < minD) { minD = d; best = snap; }
  }
  return minD < 40 ? best : pos;
}

// ─── Composant ────────────────────────────────────────────────────────────────
export default function TacticalMapEngine({
  center = [5.3365, -4.0268],
  stations = [],
  selectedAlert,
  navigationActive = false,
  speed = 0,
  heading = 0,
  onRouteDataReady,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerVehicleRef = useRef<any>(null);
  const markerDestRef = useRef<any>(null);
  const markerStationsRef = useRef<Record<string, any>>({});
  const centerRef = useRef(center);
  const mapReadyRef = useRef(false);

  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [guidanceText, setGuidanceText] = useState('');
  const [guidanceDist, setGuidanceDist] = useState(0);
  const [isAutoCentered, setIsAutoCentered] = useState(true);

  // Mettre à jour centerRef sans re-render
  useEffect(() => { centerRef.current = center; }, [center]);

  // ─── Init Map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;

    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: 'raster',
              tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap © CARTO',
            },
          },
          layers: [{ id: 'base-tiles', type: 'raster', source: 'base' }],
        },
        center: [center[1], center[0]],
        zoom: 16,
        pitch: 0,
        attributionControl: false,
      });

      map.on('load', () => { mapReadyRef.current = true; });
      map.on('dragstart', () => setIsAutoCentered(false));
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapReadyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markerVehicleRef.current = null;
      markerDestRef.current = null;
      markerStationsRef.current = {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch Route OSRM ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigationActive || !selectedAlert) {
      setRouteGeoJSON(null);
      setRouteSteps([]);
      setGuidanceText('');
      setGuidanceDist(0);
      return;
    }

    const destLat = Number(selectedAlert.lat ?? selectedAlert.latitude ?? selectedAlert.location?.lat);
    const destLng = Number(selectedAlert.lng ?? selectedAlert.longitude ?? selectedAlert.location?.lng);

    if (isNaN(destLat) || isNaN(destLng) || destLat === 0) {
      console.error('[Map] Alerte sans coordonnées valides :', JSON.stringify(selectedAlert));
      return;
    }

    const [originLat, originLng] = centerRef.current;
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true&language=fr`;
    console.log('[Map] OSRM →', url);

    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (data.code === 'Ok' && data.routes?.length > 0) {
          const route = data.routes[0];
          console.log('[Map] Route OK — distance:', (route.distance / 1000).toFixed(1), 'km');
          setRouteGeoJSON(route.geometry);
          setRouteSteps(route.legs?.[0]?.steps ?? []);
          onRouteDataReady?.({ distanceKm: route.distance / 1000, durationMin: route.duration / 60 });
        } else {
          console.error('[Map] OSRM returned:', data.code, data.message);
        }
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('[Map] fetch failed:', err); });

    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlert?.id, selectedAlert?.lat, selectedAlert?.lng, navigationActive]);

  // ─── Tracé de la route (layers MapLibre) ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyRoute = () => {
      if (!map.isStyleLoaded()) return;

      if (!routeGeoJSON || !navigationActive) {
        // Effacer le tracé
        if (map.getSource(ROUTE_SRC)) {
          (map.getSource(ROUTE_SRC) as any).setData({ type: 'FeatureCollection', features: [] });
        }
        return;
      }

      const geojson = {
        type: 'Feature' as const,
        geometry: routeGeoJSON,
        properties: {},
      };

      try {
        if (map.getSource(ROUTE_SRC)) {
          // Source existe → mise à jour des données uniquement
          (map.getSource(ROUTE_SRC) as any).setData(geojson);
          // S'assurer que les layers existent
          if (!map.getLayer(LAYER_CASING)) {
            map.addLayer({
              id: LAYER_CASING, type: 'line', source: ROUTE_SRC,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#1e3a8a', 'line-width': 16, 'line-opacity': 0.4 },
            });
          }
          if (!map.getLayer(LAYER_LINE)) {
            map.addLayer({
              id: LAYER_LINE, type: 'line', source: ROUTE_SRC,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-opacity': 1 },
            });
          }
        } else {
          // Première fois : créer source + layers dans le bon ordre
          map.addSource(ROUTE_SRC, { type: 'geojson', data: geojson });

          // 1. Halo foncé (dessous)
          map.addLayer({
            id: LAYER_CASING, type: 'line', source: ROUTE_SRC,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1e3a8a', 'line-width': 16, 'line-opacity': 0.4 },
          });

          // 2. Ligne bleue vive (dessus) — PAS de beforeId ici pour éviter l'inversion
          map.addLayer({
            id: LAYER_LINE, type: 'line', source: ROUTE_SRC,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-opacity': 1 },
          });
        }
      } catch (err) {
        console.error('[Map] addLayer/setData error:', err);
      }
    };

    if (map.isStyleLoaded()) {
      applyRoute();
    } else {
      map.once('load', applyRoute);
    }
  }, [routeGeoJSON, navigationActive]);

  // ─── Marqueur véhicule + caméra + guidance ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === 'undefined') return;

    const updateMarkers = async () => {
      if (!map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      // -- Position snap-to-road
      let displayPos = center;
      if (navigationActive && routeGeoJSON?.coordinates?.length > 1) {
        // Les coords OSRM sont [lng, lat] → on convertit en [lat, lng] pour notre format
        const latLngCoords = (routeGeoJSON.coordinates as [number, number][]).map(
          (c): [number, number] => [c[1], c[0]]
        );
        displayPos = snapPoint(center, latLngCoords);
      }
      const lngLat: [number, number] = [displayPos[1], displayPos[0]];

      // -- Marqueur flèche véhicule
      if (!markerVehicleRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
        el.innerHTML = `
          <svg viewBox="0 0 100 100" style="width:100%;height:100%;filter:drop-shadow(0 0 12px #3b82f6);transition:transform 0.2s ease;">
            <path d="M50 5 L88 90 L50 70 L12 90 Z" fill="#3b82f6" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
          </svg>`;
        markerVehicleRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        markerVehicleRef.current.setLngLat(lngLat);
      }

      // -- Marqueur destination
      const destLat = Number(selectedAlert?.lat ?? selectedAlert?.latitude ?? selectedAlert?.location?.lat);
      const destLng = Number(selectedAlert?.lng ?? selectedAlert?.longitude ?? selectedAlert?.location?.lng);
      if (navigationActive && !isNaN(destLat) && !isNaN(destLng) && destLat !== 0) {
        const destKey = selectedAlert?.id || 'dest';
        if (!markerDestRef.current) {
          const el = document.createElement('div');
          el.style.cssText = 'width:52px;height:52px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
          el.innerHTML = `
            <div style="
              background:#f43f5e;width:48px;height:48px;border-radius:50%;
              border:3px solid #fff;display:flex;align-items:center;justify-content:center;
              font-size:24px;box-shadow:0 0 24px rgba(244,63,94,0.8);
              animation:destPulse 1.2s ease-in-out infinite;
            ">🚨</div>
            <style>@keyframes destPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}</style>`;
          markerDestRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([destLng, destLat])
            .addTo(map);
        } else {
          markerDestRef.current.setLngLat([destLng, destLat]);
        }
      } else if (markerDestRef.current && !navigationActive) {
        markerDestRef.current.remove();
        markerDestRef.current = null;
      }

      // -- Rotation flèche + caméra
      const routeCoords = routeGeoJSON?.coordinates;
      const routeBearing = routeCoords?.length > 1
        ? bearing([routeCoords[0][1], routeCoords[0][0]], [routeCoords[1][1], routeCoords[1][0]])
        : 0;
      const targetBearing = heading > 0 ? heading : routeBearing;
      const svg = markerVehicleRef.current?.getElement().querySelector('svg');

      if (navigationActive && routeGeoJSON) {
        const curBearing = map.getBearing();
        const delta = ((targetBearing - curBearing + 540) % 360) - 180;
        const smoothBearing = curBearing + delta * 0.2;
        if (svg) (svg as HTMLElement).style.transform = `rotate(${targetBearing - smoothBearing}deg)`;
        if (isAutoCentered) {
          map.easeTo({
            center: lngLat,
            bearing: smoothBearing,
            pitch: 55,
            zoom: (speed * 3.6) < 20 ? 19.5 : 18,
            duration: 600,
          });
        }
      } else {
        if (svg) (svg as HTMLElement).style.transform = 'rotate(0deg)';
        if (isAutoCentered) {
          map.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, zoom: 16, duration: 800 });
        }
      }

      // -- Guidance (étape suivante)
      if (navigationActive && routeSteps.length > 0) {
        let next = routeSteps[0];
        for (let i = 0; i < routeSteps.length; i++) {
          const stepLoc: [number, number] = [routeSteps[i].maneuver.location[1], routeSteps[i].maneuver.location[0]];
          const d = haversine(center, stepLoc);
          if (d > 20) { next = routeSteps[i]; break; }
          if (d < 30 && i + 1 < routeSteps.length) { next = routeSteps[i + 1]; break; }
        }
        const distToNext = haversine(center, [next.maneuver.location[1], next.maneuver.location[0]]);
        setGuidanceText(next.maneuver.instruction ?? '');
        setGuidanceDist(Math.round(distToNext));
      } else {
        setGuidanceText('');
        setGuidanceDist(0);
      }

      // -- Marqueurs stations
      stations.forEach(s => {
        if (!s.lat || !s.lng || markerStationsRef.current[s.id]) return;
        const el = document.createElement('div');
        el.style.cssText = 'background:#1e3a5f;width:34px;height:34px;border-radius:10px;border:2px solid #3b82f6;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 4px 12px rgba(59,130,246,0.4);';
        el.innerHTML = '🏠';
        markerStationsRef.current[s.id] = new maplibregl.Marker({ element: el })
          .setLngLat([s.lng, s.lat])
          .addTo(map);
      });
    };

    if (map.isStyleLoaded()) {
      updateMarkers();
    } else {
      map.once('load', updateMarkers);
    }
  }, [center, speed, heading, navigationActive, routeGeoJSON, routeSteps, isAutoCentered, stations, selectedAlert]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={containerRef} className={styles.mapContainerMain} />

      {/* Guidance Banner */}
      {navigationActive && guidanceText && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>
            {guidanceDist < 80 ? '⚡' : guidanceDist < 250 ? '↱' : '📍'}
          </div>
          <div>
            <div className={styles.guidanceText}>{guidanceText.toUpperCase()}</div>
            <div style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 700, marginTop: 2 }}>
              {guidanceDist < 1000 ? `dans ${guidanceDist} m` : `dans ${(guidanceDist / 1000).toFixed(1)} km`}
            </div>
          </div>
        </div>
      )}

      {/* Recentrer */}
      {!isAutoCentered && (
        <button className={styles.tacticalRecenterBtn} onClick={() => setIsAutoCentered(true)}>
          🎯 RECENTRER
        </button>
      )}
    </div>
  );
}

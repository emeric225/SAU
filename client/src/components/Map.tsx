'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Identifiants des couches MapLibre ────────────────────────────────────────
const ROUTE_SOURCE_ID = 'route-source-tactical';
const ROUTE_LINE_ID = 'route-line-main';
const ROUTE_CASING_ID = 'route-line-casing';

export interface MapProps {
  center?: [number, number];
  stations?: any[];
  alerts?: any[];
  units?: any[];
  selectedAlert?: any;
  navigationActive?: boolean;
  isLiveUnitMode?: boolean;
  selfUnitId?: string;
  speed?: number;
  heading?: number;
  onRouteDataReady?: (data: { distanceKm: number; durationMin: number }) => void;
}

// ─── Fonctions mathématiques géographiques ────────────────────────────────────
function degToRad(deg: number) { return deg * Math.PI / 180; }
function radToDeg(rad: number) { return rad * 180 / Math.PI; }

function haversineDistance(pointA: [number, number], pointB: [number, number]): number {
  const R = 6371000;
  const deltaLat = degToRad(pointB[0] - pointA[0]);
  const deltaLon = degToRad(pointB[1] - pointA[1]);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(degToRad(pointA[0])) * Math.cos(degToRad(pointB[0])) * Math.sin(deltaLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function geoForwardAzimuth(pointA: [number, number], pointB: [number, number]): number {
  const lat1 = degToRad(pointA[0]), lat2 = degToRad(pointB[0]);
  const deltaLon = degToRad(pointB[1] - pointA[1]);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (radToDeg(Math.atan2(y, x)) + 360) % 360;
}

function snapToSegment(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number]
): [number, number] {
  const px = point[1], py = point[0];
  const x1 = segmentStart[1], y1 = segmentStart[0];
  const x2 = segmentEnd[1], y2 = segmentEnd[0];
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return segmentStart;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return [y1 + t * dy, x1 + t * dx];
}

// ─── Composant Principal ──────────────────────────────────────────────────────
export default function TacticalMapEngine({
  center = [5.3365, -4.0268],
  stations = [],
  alerts = [],
  selectedAlert,
  navigationActive = false,
  speed = 0,
  heading = 0,
  onRouteDataReady,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleRef = useRef<MapLibreMarker | null>(null);
  const stationRefs = useRef<Record<string, MapLibreMarker>>({});
  const alertRefs = useRef<Record<string, MapLibreMarker>>({});

  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [guidanceText, setGuidanceText] = useState<string>('');
  const [guidanceDist, setGuidanceDist] = useState<number>(0);
  const [isAutoCentered, setIsAutoCentered] = useState(true);

  // Refs pour les valeurs instables (empêche les re-renders inutiles)
  const centerRef = useRef(center);
  useEffect(() => { centerRef.current = center; }, [center]);

  // ─── Initialisation de la carte ───────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    let mapInstance: MapLibreMap;

    const initMap = async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      mapInstance = new maplibregl.Map({
        container: containerRef.current!,
        style: {
          version: 8,
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
          sources: {
            'carto-dark': {
              type: 'raster',
              tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap © CARTO',
            },
          },
          layers: [{ id: 'background-tiles', type: 'raster', source: 'carto-dark' }],
        },
        center: [center[1], center[0]],
        zoom: 16,
        pitch: 0,
        attributionControl: false,
      });
      mapInstance.on('dragstart', () => setIsAutoCentered(false));
      mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      mapRef.current = mapInstance;
    };

    initMap();
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ─── Calcul de l'itinéraire OSRM ─────────────────────────────────────────
  // Se déclenche au changement de mission ou lors de l'activation de la navigation
  useEffect(() => {
    if (!navigationActive || !selectedAlert) {
      setRouteGeoJSON(null);
      setRouteSteps([]);
      setGuidanceText('');
      return;
    }
    // Support de lat/lng ET latitude/longitude ET location.lat/location.lng
    const destLat = selectedAlert.lat ?? selectedAlert.latitude ?? selectedAlert.location?.lat;
    const destLng = selectedAlert.lng ?? selectedAlert.longitude ?? selectedAlert.location?.lng;

    if (!destLat || !destLng) {
      console.error('[Map] Alerte sans coordonnées:', JSON.stringify(selectedAlert));
      return;
    }

    const originLat = centerRef.current[0];
    const originLng = centerRef.current[1];
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true&language=fr`;
    console.log('[Map] Route vers:', destLat, destLng);

    const abortCtrl = new AbortController();
    fetch(osrmUrl, { signal: abortCtrl.signal })
      .then(res => res.json())
      .then(data => {
        if (data.code === 'Ok' && data.routes?.length > 0) {
          const route = data.routes[0];
          setRouteGeoJSON(route.geometry);
          setRouteSteps(route.legs?.[0]?.steps || []);
          onRouteDataReady?.({ distanceKm: route.distance / 1000, durationMin: route.duration / 60 });
        } else {
          console.error('[Map] OSRM error:', data.code);
        }
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('[Map] Fetch route failed:', err); });

    return () => abortCtrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlert?.id, selectedAlert?.lat, selectedAlert?.lng, navigationActive]);

  // ─── Synchronisation carte / marqueurs ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof window === 'undefined') return;

    const syncMap = async () => {
      if (!map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      // 1. Snap-to-road
      let snappedPos = center;
      if (navigationActive && routeGeoJSON?.coordinates?.length > 1) {
        let minDist = Infinity;
        const coords = routeGeoJSON.coordinates as [number, number][];
        for (let i = 0; i < coords.length - 1; i++) {
          const snap = snapToSegment(
            center,
            [coords[i][1], coords[i][0]],
            [coords[i + 1][1], coords[i + 1][0]]
          );
          const dist = haversineDistance(center, snap);
          if (dist < minDist) { minDist = dist; snappedPos = snap; }
        }
        if (minDist > 40) snappedPos = center; // Hors route → position GPS réelle
      }
      const lngLat: [number, number] = [snappedPos[1], snappedPos[0]];

      // 2. Ligne de route bleue
      if (routeGeoJSON && navigationActive) {
        const geojsonData = { type: 'Feature' as const, geometry: routeGeoJSON, properties: {} };
        if (!map.getSource(ROUTE_SOURCE_ID)) {
          map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geojsonData });
          // Casing (halo bleu doux)
          map.addLayer({
            id: ROUTE_CASING_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            paint: { 'line-color': '#1d4ed8', 'line-width': 18, 'line-opacity': 0.25 },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
          // Ligne principale bleue
          map.addLayer({
            id: ROUTE_LINE_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            paint: { 'line-color': '#3b82f6', 'line-width': 7, 'line-opacity': 1 },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          }, ROUTE_CASING_ID);
        } else {
          (map.getSource(ROUTE_SOURCE_ID) as any).setData(geojsonData);
          if (!map.getLayer(ROUTE_LINE_ID)) {
            map.addLayer({ id: ROUTE_CASING_ID, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#1d4ed8', 'line-width': 18, 'line-opacity': 0.25 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
            map.addLayer({ id: ROUTE_LINE_ID, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#3b82f6', 'line-width': 7, 'line-opacity': 1 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, ROUTE_CASING_ID);
          }
        }
      } else if (map.getSource(ROUTE_SOURCE_ID)) {
        (map.getSource(ROUTE_SOURCE_ID) as any).setData({
          type: 'FeatureCollection', features: [],
        });
      }

      // 3. Marqueur véhicule (flèche bleue)
      if (!vehicleRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:52px;height:52px;display:flex;align-items:center;justify-content:center;';
        el.innerHTML = `<svg viewBox="0 0 100 100" style="width:100%;height:100%;filter:drop-shadow(0 4px 12px rgba(59,130,246,0.6));transition:transform 0.15s linear;"><path d="M50 5 L88 92 L50 72 L12 92 Z" fill="#3b82f6" stroke="#ffffff" stroke-width="5" stroke-linejoin="round"/></svg>`;
        vehicleRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        vehicleRef.current.setLngLat(lngLat);
      }

      // 4. Cap et animation caméra
      const coords = routeGeoJSON?.coordinates;
      const routeBearing = coords?.length > 1
        ? geoForwardAzimuth([coords[0][1], coords[0][0]], [coords[1][1], coords[1][0]])
        : 0;
      const targetBearing = heading > 0 ? heading : routeBearing;
      const arrowSvg = vehicleRef.current.getElement().querySelector('svg') as SVGElement | null;

      if (navigationActive && routeGeoJSON) {
        if (isAutoCentered) {
          const currentBearing = map.getBearing();
          const delta = ((targetBearing - currentBearing + 540) % 360) - 180;
          const smoothBearing = currentBearing + delta * 0.25;
          if (arrowSvg) (arrowSvg as any).style.transform = `rotate(${targetBearing - smoothBearing}deg)`;
          map.easeTo({
            center: lngLat,
            bearing: smoothBearing,
            pitch: 50,
            zoom: speed * 3.6 < 15 ? 19.5 : 18,
            duration: 700,
          });
        }
        // Événement de navigation
        window.dispatchEvent(new Event('sau-nav-instruction'));
      } else {
        if (arrowSvg) (arrowSvg as any).style.transform = 'rotate(0deg)';
        if (isAutoCentered) {
          map.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, zoom: 16, duration: 800 });
        }
      }

      // 5. Guidance en temps réel (instruction suivante)
      if (navigationActive && routeSteps.length > 0) {
        let nextStep = routeSteps[0];
        for (let i = 0; i < routeSteps.length; i++) {
          const step = routeSteps[i];
          const stepCoord: [number, number] = [step.maneuver.location[1], step.maneuver.location[0]];
          const distToStep = haversineDistance(center, stepCoord);
          if (distToStep < 30 && i + 1 < routeSteps.length) {
            nextStep = routeSteps[i + 1];
            break;
          }
          if (distToStep > 15) { nextStep = step; break; }
        }
        const distToManeuver = haversineDistance(
          center,
          [nextStep.maneuver.location[1], nextStep.maneuver.location[0]]
        );
        setGuidanceText(nextStep.maneuver.instruction || '');
        setGuidanceDist(Math.round(distToManeuver));
      } else {
        setGuidanceText('');
        setGuidanceDist(0);
      }

      // 6. Marqueurs de stations
      stations.forEach(station => {
        if (stationRefs.current[station.id]) return;
        const el = document.createElement('div');
        el.style.cssText = 'background:#3b82f6;width:32px;height:32px;border-radius:10px;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 4px 12px rgba(59,130,246,0.5);';
        el.innerHTML = '🏠';
        stationRefs.current[station.id] = new maplibregl.Marker({ element: el })
          .setLngLat([station.lng, station.lat])
          .addTo(map);
      });

      // 7. Marqueur de destination (alerte)
      if (selectedAlert?.lat && selectedAlert?.lng) {
        const alertKey = selectedAlert.id || 'current';
        if (!alertRefs.current[alertKey]) {
          const el = document.createElement('div');
          el.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;';
          el.innerHTML = `<div style="background:#f43f5e;width:44px;height:44px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 0 20px rgba(244,63,94,0.7);animation:alertPing 1s infinite;">🚨</div>`;
          alertRefs.current[alertKey] = new maplibregl.Marker({ element: el })
            .setLngLat([selectedAlert.lng, selectedAlert.lat])
            .addTo(map);
        }
      }
    };

    if (!map.isStyleLoaded()) {
      map.once('style.load', syncMap);
    } else {
      syncMap();
    }
  }, [center, speed, heading, navigationActive, routeGeoJSON, routeSteps, isAutoCentered, stations, selectedAlert]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={containerRef} className={styles.mapContainerMain} />

      {/* Banner de guidage */}
      {navigationActive && guidanceText && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>
            {guidanceDist < 100 ? '⚡' : guidanceDist < 300 ? '➡️' : '📍'}
          </div>
          <div>
            <div className={styles.guidanceText}>{guidanceText.toUpperCase()}</div>
            <div style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 700, marginTop: 2 }}>
              Dans {guidanceDist < 1000 ? `${guidanceDist} m` : `${(guidanceDist / 1000).toFixed(1)} km`}
            </div>
          </div>
        </div>
      )}

      {/* Bouton recentrer */}
      {!isAutoCentered && (
        <button
          onClick={() => setIsAutoCentered(true)}
          className={styles.tacticalRecenterBtn}
        >
          🎯 RECENTRER
        </button>
      )}
    </div>
  );
}

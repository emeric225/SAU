'use client';
import React, { useEffect, useRef } from 'react';

interface TacticalMapProps {
  center: [number, number];   // [lat, lng]
  heading: number;
  speed: number;
  navMode: boolean;
  destination?: [number, number] | null;
  routeGeoJSON?: any;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TacticalMap — MapLibre GL JS: heading-up, 45° pitch, smooth interpolation,
   glow route line, snap-to-road visual, destination marker.
───────────────────────────────────────────────────────────────────────────── */
export const TacticalMap: React.FC<TacticalMapProps> = ({
  center, heading, speed, navMode, destination, routeGeoJSON,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const vehicleRef   = useRef<any>(null);
  const destRef      = useRef<any>(null);
  const loadedRef    = useRef(false);
  const pendingRoute = useRef<any>(null); // buffer route until map loads

  /* ── 1. Initialise MapLibre once ─────────────────────────────────────── */
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
            osm: {
              type: 'raster',
              tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
              tileSize: 256,
              attribution: '© CARTO © OSM',
            },
          },
          layers: [{ id: 'bg', type: 'raster', source: 'osm', paint: { 'raster-brightness-min': 0.0 } }],
        },
        center: [center[1], center[0]],
        zoom: 17,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        pitchWithRotate: false,
      });

      map.on('load', () => {
        loadedRef.current = true;
        // Inject any route that arrived before the map was ready
        if (pendingRoute.current) {
          applyRoute(map, pendingRoute.current);
          pendingRoute.current = null;
        }
        initMarkers(map, maplibregl);
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 2. Route layer management ───────────────────────────────────────── */
  function applyRoute(map: any, geojson: any) {
    if (!map.isStyleLoaded()) return;
    const feature = { type: 'Feature', geometry: geojson, properties: {} };

    // Remove existing layers cleanly
    ['sau-glow', 'sau-casing', 'sau-line'].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource('sau-route')) map.removeSource('sau-route');

    map.addSource('sau-route', { type: 'geojson', data: feature });
    map.addLayer({ id: 'sau-glow',   type: 'line', source: 'sau-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b82f6', 'line-width': 28, 'line-opacity': 0.18, 'line-blur': 12 } });
    map.addLayer({ id: 'sau-casing', type: 'line', source: 'sau-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1d4ed8', 'line-width': 12, 'line-opacity': 0.7 } });
    map.addLayer({ id: 'sau-line',   type: 'line', source: 'sau-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#60a5fa', 'line-width': 6, 'line-opacity': 1 } });
  }

  function clearRoute(map: any) {
    ['sau-glow', 'sau-casing', 'sau-line'].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource('sau-route')) map.removeSource('sau-route');
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!routeGeoJSON || !navMode) {
      if (loadedRef.current) clearRoute(map);
      return;
    }

    if (loadedRef.current) {
      applyRoute(map, routeGeoJSON);
    } else {
      pendingRoute.current = routeGeoJSON; // buffer until map.on('load')
    }
  }, [routeGeoJSON, navMode]);

  /* ── 3. Markers ──────────────────────────────────────────────────────── */
  async function initMarkers(map: any, mgl: any) {
    // Vehicle arrow
    const el = document.createElement('div');
    el.style.cssText = 'width:56px;height:56px;pointer-events:none;filter:drop-shadow(0 0 14px rgba(59,130,246,.8));';
    el.innerHTML = `<svg viewBox="0 0 100 100"><path d="M50 4 L92 96 L50 74 L8 96 Z" fill="#3b82f6" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>`;
    vehicleRef.current = new mgl.Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' })
      .setLngLat([center[1], center[0]])
      .addTo(map);
  }

  /* Update / create destination marker */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    (async () => {
      const mgl = (await import('maplibre-gl')).default;
      if (navMode && destination) {
        const lngLat: [number, number] = [destination[1], destination[0]];
        if (!destRef.current) {
          const el = document.createElement('div');
          el.innerHTML = '<div style="font-size:38px;filter:drop-shadow(0 4px 16px #e11d48cc);">🚨</div>';
          destRef.current = new mgl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        } else {
          destRef.current.setLngLat(lngLat);
        }
      } else if (destRef.current) {
        destRef.current.remove();
        destRef.current = null;
      }
    })();
  }, [navMode, destination?.[0], destination?.[1]]);

  /* ── 4. Camera + marker position every GPS update ────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;

    const lngLat: [number, number] = [center[1], center[0]];

    // Update vehicle marker
    if (vehicleRef.current) {
      vehicleRef.current.setLngLat(lngLat);
      vehicleRef.current.setRotation(heading);
    }

    if (navMode) {
      // Heading-up: smooth bearing towards heading, pitch 45°, unit in lower-quarter
      const curBearing = map.getBearing();
      const delta = ((heading - curBearing + 540) % 360) - 180;
      map.easeTo({
        center: lngLat,
        bearing: curBearing + delta * 0.35,
        pitch: 50,
        zoom: (speed * 3.6) < 12 ? 18.5 : 17,
        padding: { top: Math.round(window.innerHeight * 0.55), bottom: 0, left: 0, right: 0 },
        duration: 900,
        easing: (t: number) => t * (2 - t),
      });
    } else {
      map.easeTo({ center: lngLat, bearing: 0, pitch: 0, zoom: 16, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 800 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], heading, speed, navMode]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Vignette overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0,0,0,0.55) 100%)',
      }} />
    </div>
  );
};

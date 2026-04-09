'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../unit.module.css';

interface TacticalMapProps {
  center: [number, number]; // [lat, lng]
  heading: number;
  speed: number;
  navMode: boolean;
  destination?: [number, number] | null; // [lat, lng]
  routeGeoJSON?: any;
}

export const TacticalMapEngine: React.FC<TacticalMapProps> = ({
  center,
  heading,
  speed,
  navMode,
  destination,
  routeGeoJSON
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const vehicleMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const isLoadedRef = useRef(false);

  // Initialize Map
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
        zoom: 17,
        pitch: 0,
        attributionControl: false,
      });

      map.on('load', () => { isLoadedRef.current = true; });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Route Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyRoute = () => {
      if (!map.isStyleLoaded()) return;

      if (!routeGeoJSON || !navMode) {
        if (map.getSource('sau-route-src')) {
          (map.getSource('sau-route-src') as any).setData({ type: 'FeatureCollection', features: [] });
        }
        return;
      }

      const geojson = { type: 'Feature' as const, geometry: routeGeoJSON, properties: {} };

      try {
        if (map.getSource('sau-route-src')) {
          (map.getSource('sau-route-src') as any).setData(geojson);
        } else {
          map.addSource('sau-route-src', { type: 'geojson', data: geojson });
          map.addLayer({
            id: 'sau-route-casing', type: 'line', source: 'sau-route-src',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1e3a8a', 'line-width': 18, 'line-opacity': 0.4 },
          });
          map.addLayer({
            id: 'sau-route-line', type: 'line', source: 'sau-route-src',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#3b82f6', 'line-width': 8, 'line-opacity': 1 },
          });
        }
      } catch (err) { console.warn('Layer route error', err); }
    };

    if (map.isStyleLoaded()) applyRoute();
    else map.once('load', applyRoute);
  }, [routeGeoJSON, navMode]);

  // Update Camera & Markers (Interpolation at 60fps)
  useEffect(() => {
    let animationFrameId: number;
    let targetCamera: any = null;

    const setupMarkers = async () => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      const maplibregl = (await import('maplibre-gl')).default;

      // ── Vehicle ──
      if (!vehicleMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:60px;height:60px;pointer-events:none;';
        el.innerHTML = `
          <svg viewBox="0 0 100 100" style="filter:drop-shadow(0 0 15px rgba(59,130,246,0.6));">
            <path d="M50 5 L90 95 L50 75 L10 95 Z" fill="#3b82f6" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
          </svg>`;
        vehicleMarkerRef.current = new maplibregl.Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' })
          .setLngLat([center[1], center[0]])
          .addTo(map);
      } else {
        vehicleMarkerRef.current.setLngLat([center[1], center[0]]);
        vehicleMarkerRef.current.setRotation(heading);
      }

      // ── Destination ──
      if (navMode && destination) {
        if (!destMarkerRef.current) {
          const el = document.createElement('div');
          el.innerHTML = '<div style="font-size:32px; filter:drop-shadow(0 0 20px #f43f5e);">🚨</div>';
          destMarkerRef.current = new maplibregl.Marker({ element: el, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
            .setLngLat([destination[1], destination[0]])
            .addTo(map);
        } else {
          destMarkerRef.current.setLngLat([destination[1], destination[0]]);
        }
      } else if (destMarkerRef.current && !navMode) {
        destMarkerRef.current.remove();
        destMarkerRef.current = null;
      }

      // ── Camera ──
      if (navMode) {
        const curBearing = map.getBearing();
        const delta = ((heading - curBearing + 540) % 360) - 180;
        const smoothBearing = curBearing + delta * 0.4;
        
        map.easeTo({
          center: [center[1], center[0]],
          bearing: smoothBearing,
          pitch: 55,
          padding: { top: window.innerHeight * 0.6, bottom: 0, left: 0, right: 0 },
          zoom: (speed * 3.6) < 15 ? 19 : 17.5,
          duration: 1000,
          easing: (t: number) => t * (2 - t)
        });
      } else {
        map.easeTo({
          center: [center[1], center[0]],
          bearing: 0,
          pitch: 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          zoom: 16,
          duration: 1000
        });
      }
    };

    if (isLoadedRef.current) setupMarkers();

    // Using requestAnimationFrame inside if we wanted continuous tweening, but map.easeTo handles it perfectly.
    
    return () => {};
  }, [center, heading, speed, navMode, destination]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={containerRef} style={{ width: '100%', height: '100vh', position: 'absolute', top: 0, left: 0 }} />
      <div className={styles.mapOverlayGradients} />
    </div>
  );
};

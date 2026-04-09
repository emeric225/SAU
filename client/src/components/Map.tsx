'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Utils ────────────────────────────────────────────────────────────────────
export const getManeuverIcon = (type: string, mod: string) => {
  if (type === 'Straight') return '⬆️';
  if (type === 'Uturn')    return '🔄';
  if (mod === 'Left')       return '⬅️';
  if (mod === 'Right')      return '➡️';
  if (mod === 'SharpLeft')  return '↙️';
  if (mod === 'SharpRight') return '↘️';
  if (mod === 'SlightLeft') return '↖️';
  if (mod === 'SlightRight')return '↗️';
  return '⬆️';
};

export const cleanInstruction = (text: string): string => {
  if (!text) return '';
  let r = text.replace(/\u2019|\u0027/g, "'");
  r = r.replace(/(Prenez la direction|Head|Se diriger vers (l'|le |la )|Direction|Vers (l'|le |la ))(nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest)\s*(sur\s*)?(la\s+|le\s+|l')?/ig, 'CONTINUEZ SUR ');
  r = r.replace(/Turn (left|right) onto /ig, (_,d) => d==='left' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  r = r.replace(/Tournez à (gauche|droite) sur /ig, (_,d) => d==='gauche' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  return r.toUpperCase();
};

function dist(p1: [number,number], p2: [number,number]): number {
  const R=6371000, dLat=(p2[0]-p1[0])*Math.PI/180, dLon=(p2[1]-p1[1])*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function bearing(p1: [number,number], p2: [number,number]): number {
  const dL=(p2[1]-p1[1])*Math.PI/180, la1=p1[0]*Math.PI/180, la2=p2[0]*Math.PI/180;
  return ((Math.atan2(Math.sin(dL)*Math.cos(la2), Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dL))*180/Math.PI)+360)%360;
}

// ─── Main Map Component ───────────────────────────────────────────────────────
interface MapProps {
  stations?: any[]; alerts?: any[]; units?: any[];
  center?: [number,number]; selectedAlert?: any;
  navigationActive?: boolean; isLiveUnitMode?: boolean;
  selfUnitId?: string; speed?: number; heading?: number;
  onRouteDataReady?: (d:any)=>void;
}

export default function Map({
  stations=[], alerts=[], units=[],
  center=[5.3365,-4.0268],
  selectedAlert, navigationActive=false, isLiveUnitMode=false,
  selfUnitId, speed=0, heading=0,
  onRouteDataReady,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const vehicleMarker = useRef<maplibregl.Marker | null>(null);
  const stationMarkers = useRef<{ [key: string]: maplibregl.Marker }>({});
  const alertMarkers = useRef<{ [key: string]: maplibregl.Marker }>({});
  
  const [route, setRoute] = useState<any>(null);
  const [guidance, setGuidance] = useState<{text:string;icon:string;dist:number}|null>(null);
  const [autoCenter, setAutoCenter] = useState(true);

  // ── Init Map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
            tileSize: 256,
            attribution: '&copy; CARTO'
          }
        },
        layers: [{
          id: 'carto-dark-layer',
          type: 'raster',
          source: 'carto-dark',
          minzoom: 0,
          maxzoom: 20
        }]
      },
      center: [center[1], center[0]], // MapLibre uses [lng, lat]
      zoom: 16,
      pitch: 0,
      bearing: 0,
      attributionControl: false
    });

    map.current.on('dragstart', () => setAutoCenter(false));
    map.current.on('zoomstart', () => setAutoCenter(false));

    return () => {
      map.current?.remove();
    };
  }, []);

  // ── OSRM Routing Fetch ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedAlert || !center || !navigationActive) {
        setRoute(null);
        if (map.current?.getSource('route')) {
            (map.current.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
        }
        return;
    }

    const fetchRoute = async () => {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.code === 'Ok' && data.routes.length > 0) {
                const r = data.routes[0];
                setRoute(r);
                onRouteDataReady?.({ distanceKm: r.distance / 1000, durationMin: r.duration / 60 });
                
                // Update Route Layer
                if (map.current) {
                    if (!map.current.getSource('route')) {
                        map.current.addSource('route', { type: 'geojson', data: r.geometry });
                        map.current.addLayer({
                            id: 'route-line',
                            type: 'line',
                            source: 'route',
                            layout: { 'line-join': 'round', 'line-cap': 'round' },
                            paint: { 'line-color': '#3b82f6', 'line-width': 8, 'line-opacity': 0.8 }
                        });
                        map.current.addLayer({
                            id: 'route-casing',
                            type: 'line',
                            source: 'route',
                            layout: { 'line-join': 'round', 'line-cap': 'round' },
                            paint: { 'line-color': '#93c5fd', 'line-width': 14, 'line-opacity': 0.25 }
                        }, 'route-line');
                    } else {
                        (map.current.getSource('route') as maplibregl.GeoJSONSource).setData(r.geometry);
                    }
                }
            }
        } catch (e) { console.error('OSRMFetch Error', e); }
    };

    fetchRoute();
  }, [selectedAlert?.id, center[0], center[1], navigationActive]);

  // ── Update Markers & Camera ────────────────────────────────────────────────
  useEffect(() => {
    if (!map.current) return;

    // 1. Vehicle Animation & Camera
    const targetLngLat: [number, number] = [center[1], center[0]];
    
    // Create/Move Vehicle
    if (!vehicleMarker.current) {
        const el = document.createElement('div');
        el.className = styles.vehicleMarkerContainer;
        el.innerHTML = `
            <div class="${styles.vPulse}"></div>
            <div class="${styles.vPulseMid}"></div>
            <div class="${styles.vDot}"></div>
        `;
        vehicleMarker.current = new maplibregl.Marker({ element: el })
            .setLngLat(targetLngLat)
            .addTo(map.current);
    } else {
        vehicleMarker.current.setLngLat(targetLngLat);
    }

    // Camera Logic
    if (autoCenter) {
        let zoom = 16.5;
        let bearingVal = 0;
        let pitch = 0;

        if (navigationActive) {
            pitch = 45;
            const kmh = speed * 3.6;
            if (kmh < 10) zoom = 19;
            else if (kmh < 40) zoom = 18;
            else zoom = 17;

            // Rotation Logic
            if (heading > 0) bearingVal = heading;
            else if (route?.legs[0]?.steps[0]) {
                const s = route.legs[0].steps[0].geometry.coordinates;
                if (s.length > 1) {
                    bearingVal = bearing([s[0][1], s[0][0]], [s[1][1], s[1][0]]);
                }
            }
        }

        map.current.easeTo({
            center: targetLngLat,
            zoom: zoom,
            bearing: bearingVal,
            pitch: pitch,
            duration: 1000,
            easing: (t) => t
        });
    }

    // 2. Stations Markers
    stations.forEach(s => {
        if (!stationMarkers.current[s.id]) {
            const el = document.createElement('div');
            el.className = styles.stationMarker;
            el.innerHTML = '🏠';
            stationMarkers.current[s.id] = new maplibregl.Marker({ element: el })
                .setLngLat([s.lng, s.lat])
                .addTo(map.current!);
        }
    });

    // 3. Alerts Markers
    alerts.forEach(a => {
        if (!alertMarkers.current[a.id]) {
            const el = document.createElement('div');
            el.className = a.status === 'pending' ? styles.alertMarkerPulse : styles.alertMarker;
            el.innerHTML = a.type === 'fire' ? '🔥' : a.type === 'medical' ? '🚑' : '🚗';
            alertMarkers.current[a.id] = new maplibregl.Marker({ element: el })
                .setLngLat([a.lng, a.lat])
                .addTo(map.current!);
        }
    });

  }, [center, speed, heading, navigationActive, route, stations, alerts, autoCenter]);

  // ── Guidance Processing ───────────────────────────────────────────────────
  useEffect(() => {
    if (route?.legs[0]?.steps?.length > 0) {
        const step = route.legs[0].steps[0];
        setGuidance({
            text: cleanInstruction(step.maneuver.instruction),
            icon: getManeuverIcon(step.maneuver.type, step.maneuver.modifier),
            dist: Math.round(step.distance)
        });
    }
  }, [route]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={mapContainer} className={styles.mapContainerMain} style={{ width: '100%', height: '100%' }} />

      {navigationActive && guidance && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>{guidance.icon}</div>
          <div className={styles.guidanceText}>{guidance.text} ({guidance.dist}M)</div>
        </div>
      )}

      {!autoCenter && (
        <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>
          🎯 RECENTRER
        </button>
      )}
    </div>
  );
}

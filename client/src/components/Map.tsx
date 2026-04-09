'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Constants & Utils ────────────────────────────────────────────────────────
const SOURCE_ROUTE = 'route-source';
const LAYER_ROUTE_LINE = 'route-line';
const LAYER_ROUTE_CASING = 'route-casing';

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

function bearing(p1: [number,number], p2: [number,number]): number {
  const dL=(p2[1]-p1[1])*Math.PI/180, la1=p1[0]*Math.PI/180, la2=p2[0]*Math.PI/180;
  return ((Math.atan2(Math.sin(dL)*Math.cos(la2), Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dL))*180/Math.PI)+360)%360;
}

// ─── Component ────────────────────────────────────────────────────────────────
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
  selectedAlert, navigationActive=false,
  speed=0, heading=0,
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

  // 1. Map Initialization
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
          id: 'base-layer',
          type: 'raster',
          source: 'carto-dark'
        }]
      },
      center: [center[1], center[0]],
      zoom: 16.5,
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

  // 2. Routing OSRM (Cleaned & Async Shielded)
  useEffect(() => {
    if (!selectedAlert || !center || !navigationActive || !map.current) {
        setRoute(null);
        setGuidance(null);
        if (map.current?.isStyleLoaded() && map.current.getSource(SOURCE_ROUTE)) {
            (map.current.getSource(SOURCE_ROUTE) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
        }
        return;
    }

    const abortController = new AbortController();
    
    const fetchRoute = async () => {
        try {
            const url = `https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true`;
            const res = await fetch(url, { signal: abortController.signal });
            const data = await res.json();
            
            if (data.code === 'Ok' && data.routes.length > 0) {
                const r = data.routes[0];
                setRoute(r);
                onRouteDataReady?.({ distanceKm: r.distance/1000, durationMin: r.duration/60 });

                if (!map.current!.isStyleLoaded()) return;

                if (!map.current!.getSource(SOURCE_ROUTE)) {
                    map.current!.addSource(SOURCE_ROUTE, { type: 'geojson', data: r.geometry });
                    map.current!.addLayer({
                        id: LAYER_ROUTE_CASING,
                        type: 'line',
                        source: SOURCE_ROUTE,
                        paint: { 'line-color': '#3b82f6', 'line-width': 12, 'line-opacity': 0.2, 'line-blur': 4 },
                        layout: { 'line-join': 'round', 'line-cap': 'round' }
                    });
                    map.current!.addLayer({
                        id: LAYER_ROUTE_LINE,
                        type: 'line',
                        source: SOURCE_ROUTE,
                        paint: { 'line-color': '#3b82f6', 'line-width': 6 },
                        layout: { 'line-join': 'round', 'line-cap': 'round' }
                    }, LAYER_ROUTE_CASING);
                } else {
                    (map.current!.getSource(SOURCE_ROUTE) as maplibregl.GeoJSONSource).setData(r.geometry);
                }
            }
        } catch (e: any) { if(e.name !== 'AbortError') console.error('OSRMFetch Error', e); }
    };

    fetchRoute();
    return () => abortController.abort();
  }, [selectedAlert?.id, center[0], center[1], navigationActive]);

  // 3. Markers & Camera Loop
  useEffect(() => {
    if (!map.current) return;

    const target: [number, number] = [center[1], center[0]];

    // Vehicle Marker logic
    if (!vehicleMarker.current) {
        const el = document.createElement('div');
        el.className = styles.vehicleMarkerContainer;
        el.innerHTML = `<div class="${styles.vPulse}"></div><div class="${styles.vPulseMid}"></div><div class="${styles.vDot}"></div>`;
        vehicleMarker.current = new maplibregl.Marker({ element: el }).setLngLat(target).addTo(map.current);
    } else {
        vehicleMarker.current.setLngLat(target);
    }

    // Dynamic Camera
    if (autoCenter) {
        let zoom = 16.5;
        let b = map.current.getBearing();
        let p = 0;
        let targetBearing = 0;

        if (navigationActive) {
            p = 45;
            const kmh = speed * 3.6;
            if (kmh < 15) zoom = 20.5;
            else if (kmh < 40) zoom = 19;
            else zoom = 17.5;

            if (heading > 0) {
                targetBearing = heading;
            } else if (route?.legs[0]?.steps[0]?.geometry?.coordinates?.length > 1) {
                const s = route.legs[0].steps[0].geometry.coordinates;
                targetBearing = bearing([s[0][1], s[0][0]], [s[1][1], s[1][0]]);
            }
        }

        // Smooth bearing interpolation
        const diff = (targetBearing - b + 540) % 360 - 180;
        const smoothB = b + diff * 0.15; // 0.15 = lissage

        map.current.easeTo({
            center: target,
            zoom: zoom,
            bearing: smoothB,
            pitch: p,
            duration: 800,
            easing: (t) => t
        });
    }

    // Alerts Sync
    alerts.forEach(a => {
        if (!alertMarkers.current[a.id]) {
            const el = document.createElement('div');
            el.className = a.status === 'pending' ? styles.alertMarkerPulse : styles.alertMarker;
            el.innerHTML = a.type === 'fire' ? '🔥' : a.type === 'medical' ? '🚑' : '🚗';
            alertMarkers.current[a.id] = new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map.current!);
        }
    });

  }, [center, speed, heading, navigationActive, route, alerts, autoCenter]);

  // 4. Guidance Logic
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
      <div ref={mapContainer} className={styles.mapContainerMain} />

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

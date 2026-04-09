'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const SR = 'route-source';
const LR = 'route-line';
const LC = 'route-casing';

export interface MapProps {
    center: [number, number];
    stations?: any[];
    alerts?: any[];
    units?: any[];
    selectedAlert?: any;
    navigationActive?: boolean;
    isLiveUnitMode?: boolean;
    selfUnitId?: string;
    speed?: number;
    heading?: number;
    onRouteDataReady?: (d: any) => void;
}

function toRad(v: number) { return v * Math.PI / 180; }
function toDeg(v: number) { return v * 180 / Math.PI; }

function getBearing(p1: [number, number], p2: [number, number]): number {
    const lat1 = toRad(p1[0]), lat2 = toRad(p2[0]), dLon = toRad(p2[1] - p1[1]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function dist(p1: [number, number], p2: [number, number]): number {
    const R = 6371000, dLat = toRad(p2[0]-p1[0]), dLon = toRad(p2[1]-p1[1]);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(p1[0])) * Math.cos(toRad(p2[0])) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function snap(p: [number,number], a: [number,number], b: [number,number]): [number,number] {
    const x=p[1], y=p[0], x1=a[1], y1=a[0], x2=b[1], y2=b[0];
    const dx=x2-x1, dy=y2-y1;
    if(dx===0 && dy===0) return a;
    const t=((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy);
    if(t<0) return a; if(t>1) return b;
    return [y1+t*dy, x1+t*dx];
}

export default function Map({
    center, stations=[], alerts=[], units=[], selectedAlert, navigationActive=false, isLiveUnitMode=false, selfUnitId='', speed=0, heading=0, onRouteDataReady
}: MapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const vMarker = useRef<maplibregl.Marker | null>(null);
    const sMarkers = useRef<{ [key: string]: maplibregl.Marker }>({});
    
    const [route, setRoute] = useState<any>(null);
    const [guidance, setGuidance] = useState<any>(null);
    const [autoCenter, setAutoCenter] = useState(true);

    // Init Map
    useEffect(() => {
        if (!mapContainer.current) return;
        const m = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: { 'dark': { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
                layers: [{ id: 'base', type: 'raster', source: 'dark' }]
            },
            center: [center[1], center[0]], zoom: 17, pitch: 0, attributionControl: false
        });
        m.on('dragstart', () => setAutoCenter(false));
        map.current = m;
        return () => { m.remove(); };
    }, []);

    // OSRM Data
    useEffect(() => {
        if (!navigationActive || !selectedAlert) {
            setRoute(null); setGuidance(null);
            return;
        }
        fetch(`https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`)
        .then(r=>r.json()).then(data=>{
            if (data.code === 'Ok' && data.routes.length > 0) {
                const r = data.routes[0];
                setRoute(r);
                onRouteDataReady?.({ distanceKm: r.distance / 1000, durationMin: r.duration / 60 });
            }
        });
    }, [selectedAlert?.id, navigationActive, center[0], center[1]]);

    // Rendering Sync
    useEffect(() => {
        const m = map.current;
        if (!m) return;

        const sync = () => {
            if (!m.isStyleLoaded()) return;

            // 1. Snapping
            let pos = center;
            const coords = route?.geometry?.coordinates;
            if (navigationActive && coords && coords.length > 1) {
                let minD = Infinity;
                for(let i=0; i<coords.length-1; i++) {
                    const snp = snap(center, [coords[i][1], coords[i][0]], [coords[i+1][1], coords[i+1][0]]);
                    const d = dist(center, snp);
                    if (d < minD) { minD = d; pos = snp; }
                }
                if (minD > 35) pos = center;
            }
            const target: [number, number] = [pos[1], pos[0]];

            // 2. Route Layer (Ensured)
            if (route && navigationActive) {
                if (!m.getSource(SR)) {
                    m.addSource(SR, { type: 'geojson', data: route.geometry });
                    m.addLayer({ id: LC, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                    m.addLayer({ id: LR, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, LC);
                } else {
                    (m.getSource(SR) as any).setData(route.geometry);
                    if (!m.getLayer(LR)) {
                         m.addLayer({ id: LC, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                         m.addLayer({ id: LR, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, LC);
                    }
                }
            } else if (m.getSource(SR)) {
                (m.getSource(SR) as any).setData({ type: 'FeatureCollection', features: [] });
            }

            // 3. Vehicle Marker
            if (!vMarker.current) {
                const el = document.createElement('div');
                el.innerHTML = `<svg viewBox="0 0 100 100" style="width:44px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));transition:transform 0.1s linear"><path d="M50 5 L90 95 L50 75 L10 95 Z" fill="#3b82f6" stroke="#fff" stroke-width="6"/></svg>`;
                vMarker.current = new maplibregl.Marker({ element: el }).setLngLat(target).addTo(m);
            } else {
                vMarker.current.setLngLat(target);
            }

            // 4. Camera & Guidance
            if (navigationActive && route?.legs?.[0]?.steps) {
                const steps = route.legs[0].steps;
                let next = steps[0];
                for(let s of steps) { if(dist(center,[s.maneuver.location[1], s.maneuver.location[0]]) < 25) { next = steps[steps.indexOf(s)+1]||s; break; } }
                setGuidance({ text: next.maneuver.instruction.toUpperCase(), dist: Math.round(dist(center,[next.maneuver.location[1],next.maneuver.location[0]])) });
                
                let tB = heading > 0 ? heading : (coords?.length>1 ? getBearing([coords[0][1],coords[0][0]],[coords[1][1],coords[1][0]]) : 0);
                if (autoCenter) {
                    const cB = m.getBearing();
                    const sB = cB + ((tB - cB + 540) % 360 - 180) * 0.2;
                    const svg = vMarker.current.getElement().querySelector('svg') as HTMLElement;
                    if (svg) svg.style.transform = `rotate(${tB - sB}deg)`;
                    m.easeTo({ center: target, bearing: sB, pitch: 45, zoom: speed*3.6<15?20:18.5, duration: 800 });
                }
            } else {
                if (autoCenter) m.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, duration: 800 });
                const svg = vMarker.current.getElement().querySelector('svg') as HTMLElement;
                if (svg) svg.style.transform = `rotate(0deg)`;
            }

            // 5. Stations
            stations.forEach(s => {
                if (sMarkers.current[s.id]) return;
                const el = document.createElement('div'); el.style.background='#3b82f6'; el.style.width='24px'; el.style.height='24px'; el.style.borderRadius='6px'; el.style.border='2px solid #fff'; el.style.display='flex'; el.style.alignItems='center'; el.style.justifyContent='center'; el.style.fontSize='12px'; el.innerHTML='🏠';
                sMarkers.current[s.id] = new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m);
            });
        };

        if (!m.isStyleLoaded()) {
            m.once('style.load', sync);
        } else {
            sync();
        }
    }, [center, speed, heading, navigationActive, route, autoCenter, stations, alerts]);

    return (
        <div className={styles.mapWrapper}>
            <div ref={mapContainer} className={styles.mapContainerMain} />
            {navigationActive && guidance && (<div className={styles.guidanceBanner}><div className={styles.guidanceText}>{guidance.text} ({guidance.dist}M)</div></div>)}
            {!autoCenter && <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>🎯 RECENTRER</button>}
        </div>
    );
}

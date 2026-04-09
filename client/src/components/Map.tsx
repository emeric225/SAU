'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const SR = 'route-source';
const LR = 'route-line';
const LC = 'route-casing';

// ─── Mathematical Utils ──────────────────────────────────────────────────────
function toRad(v: number) { return v * Math.PI / 180; }
function toDeg(v: number) { return v * 180 / Math.PI; }

function getBearing(p1: [number, number], p2: [number, number]): number {
    const lat1 = toRad(p1[0]), lat2 = toRad(p2[0]);
    const dLon = toRad(p2[1] - p1[1]);
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

interface MapProps {
    center: [number, number];
    alerts?: any[];
    selectedAlert?: any;
    navigationActive?: boolean;
    speed?: number;
    heading?: number;
    onRouteDataReady?: (d: any) => void;
}

export default function Map({
    center, alerts=[], selectedAlert, navigationActive=false, speed=0, heading=0, onRouteDataReady
}: MapProps) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const vMarker = useRef<maplibregl.Marker | null>(null);
    const [route, setRoute] = useState<any>(null);
    const [guidance, setGuidance] = useState<any>(null);
    const [autoCenter, setAutoCenter] = useState(true);
    const lastB = useRef(0);

    // 1. Initialisation MapLibre
    useEffect(() => {
        if (!mapContainer.current) return;
        map.current = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: { 'dark': { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
                layers: [{ id: 'base', type: 'raster', source: 'dark' }]
            },
            center: [center[1], center[0]],
            zoom: 17,
            pitch: 0,
            bearing: 0,
            attributionControl: false
        });

        map.current.on('dragstart', () => setAutoCenter(false));
        return () => { map.current?.remove(); };
    }, []);

    // 2. Routage OSRM
    useEffect(() => {
        if (!navigationActive || !selectedAlert || !map.current) {
            setRoute(null); setGuidance(null);
            if (map.current?.isStyleLoaded() && map.current.getSource(SR)) {
                (map.current.getSource(SR) as any).setData({type:'FeatureCollection',features:[]});
            }
            return;
        }

        const fetchRoute = async () => {
            try {
                const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`);
                const data = await res.json();
                if (data.code === 'Ok' && data.routes.length > 0) {
                    const r = data.routes[0];
                    setRoute(r);
                    onRouteDataReady?.({ distanceKm: r.distance / 1000, durationMin: r.duration / 60 });
                    
                    if (!map.current?.isStyleLoaded()) return;
                    if (!map.current.getSource(SR)) {
                        map.current.addSource(SR, { type: 'geojson', data: r.geometry });
                        map.current.addLayer({ id: LC, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 16, 'line-opacity': 0.2, 'line-blur': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                        map.current.addLayer({ id: LR, type: 'line', source: SR, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, LC);
                    } else {
                        (map.current.getSource(SR) as any).setData(r.geometry);
                    }
                }
            } catch (e) { console.error('OSRMFetch failed', e); }
        };

        fetchRoute();
    }, [selectedAlert?.id, navigationActive]);

    // 3. Boucle Tactique (Rendu & Caméra)
    useEffect(() => {
        if (!map.current) return;

        // Snapping
        let pos = center;
        const coords = route?.geometry?.coordinates;
        if (navigationActive && coords && coords.length > 1) {
            let minD = Infinity;
            for(let i=0; i<coords.length-1; i++) {
                const snapped = snap(center, [coords[i][1], coords[i][0]], [coords[i+1][1], coords[i+1][0]]);
                const d = dist(center, snapped);
                if (d < minD) { minD = d; pos = snapped; }
            }
            if (minD > 30) pos = center; // Don't snap if too far
        }

        const target: [number, number] = [pos[1], pos[0]];

        // Marker Sync
        if (!vMarker.current) {
            const el = document.createElement('div');
            el.className = 'v-arrow-fix';
            el.innerHTML = `<svg viewBox="0 0 100 100" style="width:44px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6))"><path d="M50 5 L90 95 L50 75 L10 95 Z" fill="#3b82f6" stroke="#fff" stroke-width="6"/></svg>`;
            vMarker.current = new maplibregl.Marker({ element: el }).setLngLat(target).addTo(map.current);
        } else {
            vMarker.current.setLngLat(target);
        }

        // Guidance & Rotation
        if (navigationActive && route?.legs?.[0]?.steps) {
            const steps = route.legs[0].steps;
            let nextStep = steps[0];
            for (let i = 0; i < steps.length; i++) {
                if (dist(center, [steps[i].maneuver.location[1], steps[i].maneuver.location[0]]) < 25) {
                    nextStep = steps[i+1] || steps[i];
                    break;
                }
            }
            const dToNext = dist(center, [nextStep.maneuver.location[1], nextStep.maneuver.location[0]]);
            setGuidance({ text: nextStep.maneuver.instruction.toUpperCase(), dist: Math.round(dToNext) });
            
            // Camera Rotation base logic
            let targetB = 0;
            if (heading > 0) targetB = heading;
            else if (coords?.length > 1) targetB = getBearing([coords[0][1], coords[0][0]], [coords[1][1], coords[1][0]]);

            if (autoCenter) {
                const curB = map.current.getBearing();
                const diff = (targetB - curB + 540) % 360 - 180;
                const smoothB = curB + diff * 0.2;
                lastB.current = smoothB;
                
                // Rotate Marker relative to map
                const svg = vMarker.current.getElement().querySelector('svg') as HTMLElement;
                if (svg) svg.style.transform = `rotate(${targetB - smoothB}deg)`;

                map.current.easeTo({ center: target, bearing: smoothB, pitch: 45, zoom: speed*3.6<15 ? 20 : 18, duration: 800, easing: t=>t });
            }
        } else {
            if (autoCenter) map.current.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, duration: 800 });
            const svg = vMarker.current.getElement().querySelector('svg') as HTMLElement;
            if (svg) svg.style.transform = `rotate(0deg)`;
        }
    }, [center, speed, heading, navigationActive, route, autoCenter]);

    return (
        <div className={styles.mapWrapper}>
            <div ref={mapContainer} className={styles.mapContainerMain} />
            {navigationActive && guidance && (
                <div className={styles.guidanceBanner}>
                    <div className={styles.guidanceText}>{guidance.text} ({guidance.dist}M)</div>
                </div>
            )}
            {!autoCenter && <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>🎯 RECENTRER</button>}
        </div>
    );
}

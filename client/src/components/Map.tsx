'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

const TACTICAL_ROUTE_SOURCE = 'route-source-tactical';
const TACTICAL_ROUTE_LINE = 'route-line-main';
const TACTICAL_ROUTE_CASING = 'route-line-casing';

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
    onRouteDataReady?: (data: any) => void;
}

function convertToRadians(value: number) { return value * Math.PI / 180; }
function convertToDegrees(value: number) { return value * 180 / Math.PI; }

function getTacticalBearingValue(startPoint: [number, number], endPoint: [number, number]): number {
    const lat1 = convertToRadians(startPoint[0]), lat2 = convertToRadians(endPoint[0]), lonDiff = convertToRadians(endPoint[1] - startPoint[1]);
    const y = Math.sin(lonDiff) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lonDiff);
    return (convertToDegrees(Math.atan2(y, x)) + 360) % 360;
}

function getTacticalDistanceValue(point1: [number, number], point2: [number, number]): number {
    const RADIUS = 6371000;
    const dLat = convertToRadians(point2[0] - point1[0]), dLon = convertToRadians(point2[1] - point1[1]);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(convertToRadians(point1[0])) * Math.cos(convertToRadians(point2[0])) * Math.sin(dLon / 2) ** 2;
    return RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectTacticalPointOnLine(target: [number, number], lineStart: [number, number], lineEnd: [number, number]): [number, number] {
    const tx = target[1], ty = target[0], x1 = lineStart[1], y1 = lineStart[0], x2 = lineEnd[1], y2 = lineEnd[0];
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return lineStart;
    const factor = ((tx - x1) * dx + (ty - y1) * dy) / (dx * dx + dy * dy);
    if (factor < 0) return lineStart; if (factor > 1) return lineEnd;
    return [y1 + factor * dy, x1 + factor * dx];
}

export default function TacticalMapEngine({
    center = [5.3365, -4.0268],
    stations = [],
    alerts = [],
    selectedAlert,
    navigationActive = false,
    speed = 0,
    heading = 0,
    onRouteDataReady
}: MapProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<MapLibreMap | null>(null);
    const vehicleMarkerRef = useRef<MapLibreMarker | null>(null);
    const stationMarkersMapRef = useRef<{ [key: string]: MapLibreMarker }>({});
    
    const [tacticalRouteData, setTacticalRouteData] = useState<any>(null);
    const [tacticalGuidanceInfo, setTacticalGuidanceInfo] = useState<any>(null);
    const [isTacticalAutoCentered, setIsTacticalAutoCentered] = useState(true);

    useEffect(() => {
        if (!mapContainerRef.current || typeof window === 'undefined') return;
        
        let map: MapLibreMap;
        const initializeMap = async () => {
            const maplibregl = (await import('maplibre-gl')).default;
            map = new maplibregl.Map({
                container: mapContainerRef.current!,
                style: {
                    version: 8,
                    sources: { 'carto-dark': { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
                    layers: [{ id: 'carto-dark-layer', type: 'raster', source: 'carto-dark' }]
                },
                center: [center[1], center[0]], zoom: 17, attributionControl: false
            });
            map.on('dragstart', () => setIsTacticalAutoCentered(false));
            mapInstanceRef.current = map;
        };

        initializeMap();
        return () => { mapInstanceRef.current?.remove(); };
    }, []);

    useEffect(() => {
        if (!navigationActive || !selectedAlert) { setTacticalRouteData(null); setTacticalGuidanceInfo(null); return; }
        fetch(`https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`)
        .then(r => r.json()).then(res => {
            if (res.code === 'Ok' && res.routes.length > 0) {
                const route = res.routes[0];
                setTacticalRouteData(route);
                onRouteDataReady?.({ distanceKm: route.distance / 1000, durationMin: route.duration / 60 });
            }
        });
    }, [selectedAlert?.id, navigationActive, center[0], center[1]]);

    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || typeof window === 'undefined') return;

        const performTacticalSync = async () => {
            if (!map.isStyleLoaded()) return;
            const maplibregl = (await import('maplibre-gl')).default;

            let finalPos = center;
            const coords = tacticalRouteData?.geometry?.coordinates;
            if (navigationActive && coords && coords.length > 1) {
                let minD = Infinity;
                for (let i = 0; i < coords.length - 1; i++) {
                    const snap = projectTacticalPointOnLine(center, [coords[i][1], coords[i][0]], [coords[i + 1][1], coords[i + 1][0]]);
                    const d = getTacticalDistanceValue(center, snap);
                    if (d < minD) { minD = d; finalPos = snap; }
                }
                if (minD > 35) finalPos = center;
            }
            const mapCenter: [number, number] = [finalPos[1], finalPos[0]];

            if (tacticalRouteData && navigationActive) {
                if (!map.getSource(TACTICAL_ROUTE_SOURCE)) {
                    map.addSource(TACTICAL_ROUTE_SOURCE, { type: 'geojson', data: tacticalRouteData.geometry });
                    map.addLayer({ id: TACTICAL_ROUTE_CASING, type: 'line', source: TACTICAL_ROUTE_SOURCE, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                    map.addLayer({ id: TACTICAL_ROUTE_LINE, type: 'line', source: TACTICAL_ROUTE_SOURCE, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, TACTICAL_ROUTE_CASING);
                } else {
                    (map.getSource(TACTICAL_ROUTE_SOURCE) as any).setData(tacticalRouteData.geometry);
                    if (!map.getLayer(TACTICAL_ROUTE_LINE)) {
                         map.addLayer({ id: TACTICAL_ROUTE_CASING, type: 'line', source: TACTICAL_ROUTE_SOURCE, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                         map.addLayer({ id: TACTICAL_ROUTE_LINE, type: 'line', source: TACTICAL_ROUTE_SOURCE, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, TACTICAL_ROUTE_CASING);
                    }
                }
            } else if (map.getSource(TACTICAL_ROUTE_SOURCE)) {
                (map.getSource(TACTICAL_ROUTE_SOURCE) as any).setData({ type: 'FeatureCollection', features: [] });
            }

            if (!vehicleMarkerRef.current) {
                const el = document.createElement('div');
                el.innerHTML = `<svg viewBox="0 0 100 100" style="width:44px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));transition:transform 0.1s linear"><path d="M50 5 L90 95 L50 75 L10 95 Z" fill="#3b82f6" stroke="#fff" stroke-width="6"/></svg>`;
                vehicleMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(mapCenter).addTo(map);
            } else {
                vehicleMarkerRef.current.setLngLat(mapCenter);
            }

            if (navigationActive && tacticalRouteData?.legs?.[0]?.steps) {
                const s = tacticalRouteData.legs[0].steps;
                let next = s[0];
                for (const step of s) { if (getTacticalDistanceValue(center, [step.maneuver.location[1], step.maneuver.location[0]]) < 25) { next = s[s.indexOf(step) + 1] || step; break; } }
                setTacticalGuidanceInfo({ text: next.maneuver.instruction.toUpperCase(), dist: Math.round(getTacticalDistanceValue(center, [next.maneuver.location[1], next.maneuver.location[0]])) });
                
                let targetB = heading > 0 ? heading : (coords?.length > 1 ? getTacticalBearingValue([coords[0][1], coords[0][0]], [coords[1][1], coords[1][0]]) : 0);
                if (isTacticalAutoCentered) {
                    const currentB = map.getBearing();
                    const smoothB = currentB + ((targetB - currentB + 540) % 360 - 180) * 0.2;
                    const svg = vehicleMarkerRef.current.getElement().querySelector('svg') as any;
                    if (svg) svg.style.transform = `rotate(${targetB - smoothB}deg)`;
                    map.easeTo({ center: mapCenter, bearing: smoothB, pitch: 45, zoom: speed * 3.6 < 15 ? 20 : 18.5, duration: 800 });
                }
            } else {
                if (isTacticalAutoCentered) map.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, duration: 800 });
                const svg = vehicleMarkerRef.current?.getElement().querySelector('svg') as any;
                if (svg) svg.style.transform = `rotate(0deg)`;
            }

            stations.forEach(st => {
                if (stationMarkersMapRef.current[st.id]) return;
                const el = document.createElement('div'); el.style.background = '#3b82f6'; el.style.width = '24px'; el.style.height = '24px'; el.style.borderRadius = '6px'; el.style.border = '2px solid #fff'; el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center'; el.style.fontSize = '12px'; el.innerHTML = '🏠';
                stationMarkersMapRef.current[st.id] = new maplibregl.Marker({ element: el }).setLngLat([st.lng, st.lat]).addTo(map);
            });
        };

        if (!map.isStyleLoaded()) { map.once('style.load', performTacticalSync); } else { performTacticalSync(); }
    }, [center, speed, heading, navigationActive, tacticalRouteData, isTacticalAutoCentered, stations, alerts]);

    return (
        <div className={styles.mapWrapper}>
            <div ref={mapContainerRef} className={styles.mapContainerMain} />
            {navigationActive && tacticalGuidanceInfo && (
                <div className={styles.guidanceBanner}>
                    <div className={styles.guidanceText}>{tacticalGuidanceInfo.text} ({tacticalGuidanceInfo.dist}M)</div>
                </div>
            )}
            {!isTacticalAutoCentered && (
                <button onClick={() => setIsTacticalAutoCentered(true)} className={styles.tacticalRecenterBtn}>🎯 RECENTRER</button>
            )}
        </div>
    );
}

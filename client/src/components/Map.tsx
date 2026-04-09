'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Constants ───────────────────────────────────────────────────────────────
const ROUTE_SOURCE_ID = 'route-source-tactical';
const ROUTE_LINE_LAYER = 'route-line-main';
const ROUTE_CASING_LAYER = 'route-line-casing';

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

function calculateToRad(val: number) { return val * Math.PI / 180; }
function calculateToDeg(val: number) { return val * 180 / Math.PI; }

function getTacticalBearing(pStart: [number, number], pEnd: [number, number]): number {
    const startLat = calculateToRad(pStart[0]);
    const endLat = calculateToRad(pEnd[0]);
    const diffLon = calculateToRad(pEnd[1] - pStart[1]);
    const yVal = Math.sin(diffLon) * Math.cos(endLat);
    const xVal = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(diffLon);
    return (calculateToDeg(Math.atan2(yVal, xVal)) + 360) % 360;
}

function getTacticalDist(p1: [number, number], p2: [number, number]): number {
    const EARTH_RADIUS = 6371000;
    const dLat = calculateToRad(p2[0] - p1[0]);
    const dLon = calculateToRad(p2[1] - p1[1]);
    const haversineValue = Math.sin(dLat / 2) ** 2 + Math.cos(calculateToRad(p1[0])) * Math.cos(calculateToRad(p2[0])) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue));
}

function projectPointOnLine(p: [number, number], start: [number, number], end: [number, number]): [number, number] {
    const px = p[1], py = p[0], x1 = start[1], y1 = start[0], x2 = end[1], y2 = end[0];
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return start;
    const projectionFactor = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    if (projectionFactor < 0) return start;
    if (projectionFactor > 1) return end;
    return [y1 + projectionFactor * dy, x1 + projectionFactor * dx];
}

export default function MapComponent({
    center = [5.3365, -4.0268],
    stations = [],
    alerts = [],
    units = [],
    selectedAlert,
    navigationActive = false,
    speed = 0,
    heading = 0,
    onRouteDataReady
}: MapProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<maplibregl.Map | null>(null);
    const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
    const stationMarkersRef = useRef<{ [key: string]: maplibregl.Marker }>({});
    
    const [activeRoute, setActiveRoute] = useState<any>(null);
    const [guidanceData, setGuidanceData] = useState<any>(null);
    const [isAutoCentered, setIsAutoCentered] = useState(true);

    // Initialisation MapLibre
    useEffect(() => {
        if (!mapContainerRef.current) return;
        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: {
                version: 8,
                sources: { 'carto-dark-base': { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
                layers: [{ id: 'raster-base', type: 'raster', source: 'carto-dark-base' }]
            },
            center: [center[1], center[0]], zoom: 17, pitch: 0, attributionControl: false
        });
        map.on('dragstart', () => setIsAutoCentered(false));
        mapInstance.current = map;
        return () => { map.remove(); };
    }, []);

    // Route Fetching (OSRM)
    useEffect(() => {
        if (!navigationActive || !selectedAlert) {
            setActiveRoute(null); setGuidanceData(null);
            return;
        }
        fetch(`https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`)
        .then(res => res.json()).then(result => {
            if (result.code === 'Ok' && result.routes.length > 0) {
                const route = result.routes[0];
                setActiveRoute(route);
                onRouteDataReady?.({ distanceKm: route.distance / 1000, durationMin: route.duration / 60 });
            }
        });
    }, [selectedAlert?.id, navigationActive, center[0], center[1]]);

    // Tactical Visual Sync
    useEffect(() => {
        const map = mapInstance.current;
        if (!map) return;

        const performSync = () => {
            if (!map.isStyleLoaded()) return;

            // 1. Snapping Logic
            let finalGpsPos = center;
            const routeCoords = activeRoute?.geometry?.coordinates;
            if (navigationActive && routeCoords && routeCoords.length > 1) {
                let minDistance = Infinity;
                for (let i = 0; i < routeCoords.length - 1; i++) {
                    const snapped = projectPointOnLine(center, [routeCoords[i][1], routeCoords[i][0]], [routeCoords[i + 1][1], routeCoords[i + 1][0]]);
                    const currentDistance = getTacticalDist(center, snapped);
                    if (currentDistance < minDistance) { minDistance = currentDistance; finalGpsPos = snapped; }
                }
                if (minDistance > 35) finalGpsPos = center;
            }
            const mapTargetPos: [number, number] = [finalGpsPos[1], finalGpsPos[0]];

            // 2. Route Layer Injection
            if (activeRoute && navigationActive) {
                if (!map.getSource(ROUTE_SOURCE_ID)) {
                    map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: activeRoute.geometry });
                    map.addLayer({ id: ROUTE_CASING_LAYER, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                    map.addLayer({ id: ROUTE_LINE_LAYER, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, ROUTE_CASING_LAYER);
                } else {
                    (map.getSource(ROUTE_SOURCE_ID) as any).setData(activeRoute.geometry);
                    if (!map.getLayer(ROUTE_LINE_LAYER)) {
                         map.addLayer({ id: ROUTE_CASING_LAYER, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#3b82f6', 'line-width': 18, 'line-opacity': 0.15, 'line-blur': 10 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
                         map.addLayer({ id: ROUTE_LINE_LAYER, type: 'line', source: ROUTE_SOURCE_ID, paint: { 'line-color': '#3b82f6', 'line-width': 8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }, ROUTE_CASING_LAYER);
                    }
                }
            } else if (map.getSource(ROUTE_SOURCE_ID)) {
                (map.getSource(ROUTE_SOURCE_ID) as any).setData({ type: 'FeatureCollection', features: [] });
            }

            // 3. Vehicle Arrow Sync
            if (!vehicleMarkerRef.current) {
                const element = document.createElement('div');
                element.innerHTML = `<svg viewBox="0 0 100 100" style="width:44px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,0.6));transition:transform 0.1s linear"><path d="M50 5 L90 95 L50 75 L10 95 Z" fill="#3b82f6" stroke="#fff" stroke-width="6"/></svg>`;
                vehicleMarkerRef.current = new maplibregl.Marker({ element: element }).setLngLat(mapTargetPos).addTo(map);
            } else {
                vehicleMarkerRef.current.setLngLat(mapTargetPos);
            }

            // 4. Guidance & Camera Animation
            if (navigationActive && activeRoute?.legs?.[0]?.steps) {
                const steps = activeRoute.legs[0].steps;
                let nextStep = steps[0];
                for (const step of steps) {
                    if (getTacticalDist(center, [step.maneuver.location[1], step.maneuver.location[0]]) < 25) {
                        nextStep = steps[steps.indexOf(step) + 1] || step;
                        break;
                    }
                }
                const distanceToManeuver = getTacticalDist(center, [nextStep.maneuver.location[1], nextStep.maneuver.location[0]]);
                setGuidanceData({ text: nextStep.maneuver.instruction.toUpperCase(), dist: Math.round(distanceToManeuver) });
                
                let targetBearing = heading > 0 ? heading : (routeCoords?.length > 1 ? getTacticalBearing([routeCoords[0][1], routeCoords[0][0]], [routeCoords[1][1], routeCoords[1][0]]) : 0);
                
                if (isAutoCentered) {
                    const currentMapBearing = map.getBearing();
                    const smoothBearing = currentMapBearing + ((targetBearing - currentMapBearing + 540) % 360 - 180) * 0.2;
                    const arrowSvg = vehicleMarkerRef.current.getElement().querySelector('svg') as any;
                    if (arrowSvg) arrowSvg.style.transform = `rotate(${targetBearing - smoothBearing}deg)`;
                    map.easeTo({ center: mapTargetPos, bearing: smoothBearing, pitch: 45, zoom: speed * 3.6 < 15 ? 20 : 18.5, duration: 800 });
                }
            } else {
                if (isAutoCentered) map.easeTo({ center: [center[1], center[0]], pitch: 0, bearing: 0, duration: 800 });
                const arrowSvg = vehicleMarkerRef.current?.getElement().querySelector('svg') as any;
                if (arrowSvg) arrowSvg.style.transform = `rotate(0deg)`;
            }

            // 5. Station Markers Sync
            stations.forEach(station => {
                if (stationMarkersRef.current[station.id]) return;
                const stationElement = document.createElement('div');
                stationElement.style.background = '#3b82f6'; stationElement.style.width = '24px'; stationElement.style.height = '24px';
                stationElement.style.borderRadius = '6px'; stationElement.style.border = '2px solid #fff';
                stationElement.style.display = 'flex'; stationElement.style.alignItems = 'center'; stationElement.style.justifyContent = 'center';
                stationElement.style.fontSize = '12px'; stationElement.innerHTML = '🏠';
                stationMarkersRef.current[station.id] = new maplibregl.Marker({ element: stationElement }).setLngLat([station.lng, station.lat]).addTo(map);
            });
        };

        if (!map.isStyleLoaded()) {
            map.once('style.load', performSync);
        } else {
            performSync();
        }
    }, [center, speed, heading, navigationActive, activeRoute, isAutoCentered, stations, alerts]);

    return (
        <div className={styles.mapWrapper}>
            <div ref={mapContainerRef} className={styles.mapContainerMain} />
            {navigationActive && guidanceData && (
                <div className={styles.guidanceBanner}>
                    <div className={styles.guidanceText}>{guidanceData.text} ({guidanceData.dist}M)</div>
                </div>
            )}
            {!isAutoCentered && (
                <button onClick={() => setIsAutoCentered(true)} className={styles.tacticalRecenterBtn}>🎯 RECENTRER</button>
            )}
        </div>
    );
}

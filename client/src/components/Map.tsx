'use client';

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from '../app/unit/unit.module.css';

// ─── Constants & Utils ────────────────────────────────────────────────────────
const SOURCE_ROUTE = 'route-source';
const LAYER_ROUTE_LINE = 'route-line';
const LAYER_ROUTE_CASING = 'route-casing';

function dist(p1: [number,number], p2: [number,number]): number {
  const R=6371000, dLat=(p2[0]-p1[0])*Math.PI/180, dLon=(p2[1]-p1[1])*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function bearing(p1: [number,number], p2: [number,number]): number {
  const dL=(p2[1]-p1[1])*Math.PI/180, la1=p1[0]*Math.PI/180, la2=p2[0]*Math.PI/180;
  return ((Math.atan2(Math.sin(dL)*Math.cos(la2), Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dL))*180/Math.PI)+360)%360;
}

const getManeuverIcon = (type: string, mod?: string) => {
  if (type === 'turn' && mod?.includes('left')) return '⬅️';
  if (type === 'turn' && mod?.includes('right')) return '➡️';
  if (type === 'on ramp') return '↗️';
  if (type === 'off ramp') return '↘️';
  if (type === 'roundabout') return '⭕';
  if (type === 'arrive') return '🏁';
  return '⬆️';
};

// Snap logic: finds the closest point on the line segment
function snapToLine(p: [number,number], a: [number,number], b: [number,number]): [number,number] {
    const x=p[1], y=p[0], x1=a[1], y1=a[0], x2=b[1], y2=b[0];
    const dx=x2-x1, dy=y2-y1;
    if(dx===0 && dy===0) return a;
    const t=((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy);
    if(t<0) return a; if(t>1) return b;
    return [y1+t*dy, x1+t*dx];
}

function getSnappedPos(gps: [number,number], coords: any[]): [number,number] {
    if(!coords || coords.length<2) return gps;
    let minD=Infinity, best:[number,number]=gps;
    for(let i=0; i<coords.length-1; i++){
        const p1:[number,number]=[coords[i][1], coords[i][0]];
        const p2:[number,number]=[coords[i+1][1], coords[i+1][0]];
        const snapped=snapToLine(gps, p1, p2);
        const d=dist(gps, snapped);
        if(d<minD){ minD=d; best=snapped; }
    }
    return minD < 25 ? best : gps;
}

export const cleanInstruction = (text: string): string => {
  if (!text) return '';
  let r = text.replace(/\u2019|\u0027/g, "'");
  r = r.replace(/(Prenez la direction|Head|Se diriger vers (l'|le |la )|Direction|Vers (l'|le |la ))(nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest)\s*(sur\s*)?(la\s+|le\s+|l')?/ig, 'CONTINUEZ SUR ');
  r = r.replace(/Turn (left|right) onto /ig, (_,d) => d==='left' ? 'TOURNER À GAUCHE SUR ' : 'TOURNER À DROITE SUR ');
  return r.toUpperCase();
};

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
  selfUnitId, speed=0, heading=0, onRouteDataReady,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const vehicleMarker = useRef<maplibregl.Marker | null>(null);
  const alertMarkers = useRef<{ [key: string]: maplibregl.Marker }>({});
  
  const [route, setRoute] = useState<any>(null);
  const [guidance, setGuidance] = useState<any>(null);
  const [autoCenter, setAutoCenter] = useState(true);
  const lastInstructionRef = useRef('');

  useEffect(() => {
    if (!mapContainer.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { 'carto-dark': { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
        layers: [{ id: 'base', type: 'raster', source: 'carto-dark' }]
      },
      center: [center[1], center[0]], zoom: 16.5, attributionControl: false
    });
    map.current.on('dragstart', () => setAutoCenter(false));
    return () => { map.current?.remove(); };
  }, []);

  // OSRM Routing
  useEffect(() => {
    if (!selectedAlert || !navigationActive || !map.current) {
        setRoute(null); setGuidance(null);
        if (map.current?.isStyleLoaded() && map.current.getSource(SOURCE_ROUTE)) (map.current.getSource(SOURCE_ROUTE) as any).setData({type:'FeatureCollection',features:[]});
        return;
    }
    const abort = new AbortController();
    fetch(`https://router.project-osrm.org/route/v1/driving/${center[1]},${center[0]};${selectedAlert.lng},${selectedAlert.lat}?overview=full&geometries=geojson&steps=true&language=fr`, {signal:abort.signal})
    .then(r=>r.json()).then(data=>{
        if(data.code==='Ok' && data.routes.length>0){
            const r=data.routes[0]; setRoute(r);
            onRouteDataReady?.({ distanceKm: r.distance/1000, durationMin: r.duration/60 });
            if(!map.current?.isStyleLoaded()) return;
            if(!map.current.getSource(SOURCE_ROUTE)){
                map.current.addSource(SOURCE_ROUTE, {type:'geojson', data:r.geometry});
                map.current.addLayer({id:LAYER_ROUTE_CASING, type:'line', source:SOURCE_ROUTE, paint:{'line-color':'#3b82f6','line-width':14,'line-opacity':0.15,'line-blur':6}, layout:{'line-join':'round','line-cap':'round' }});
                map.current.addLayer({id:LAYER_ROUTE_LINE, type:'line', source:SOURCE_ROUTE, paint:{'line-color':'#3b82f6','line-width':7}, layout:{'line-join':'round','line-cap':'round' }}, LAYER_ROUTE_CASING);
            } else (map.current.getSource(SOURCE_ROUTE) as any).setData(r.geometry);
        }
    }).catch(e=>e.name!=='AbortError'&&console.error(e));
    return () => abort.abort();
  }, [selectedAlert?.id, center[0], center[1], navigationActive]);

  // Guidance Follower + Camera Loop
  useEffect(() => {
    if (!map.current) return;

    const routeCoords = route?.geometry?.coordinates;
    const finalPos = (navigationActive && routeCoords) ? getSnappedPos(center, routeCoords) : center;
    const target:[number,number] = [finalPos[1], finalPos[0]];

    // 1. Find Current Instruction
    if (route?.legs?.[0]?.steps) {
        const steps = route.legs[0].steps;
        // Find first step that is ahead of us
        let nextStep = steps[0];
        for (let i = 0; i < steps.length; i++) {
            const stepPos: [number,number] = [steps[i].maneuver.location[1], steps[i].maneuver.location[0]];
            const d = dist(center, stepPos);
            if (d < 30) {
                nextStep = steps[i+1] || steps[i];
                break;
            }
        }
        
        const inst = cleanInstruction(nextStep.maneuver.instruction);
        const distanceToNext = dist(center, [nextStep.maneuver.location[1], nextStep.maneuver.location[0]]);
        
        if (inst !== lastInstructionRef.current) {
            lastInstructionRef.current = inst;
            window.dispatchEvent(new CustomEvent('sau-nav-instruction'));
        }

        setGuidance({
            text: inst,
            icon: getManeuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier),
            dist: Math.round(distanceToNext)
        });
    }

    // 2. Vehicle Marker
    if (!vehicleMarker.current) {
        const el = document.createElement('div');
        el.className = 'v-arrow-container';
        el.innerHTML = `<svg viewBox="0 0 100 100" class="v-arrow-svg"><path d="M50 0 L90 90 L50 70 L10 90 Z" fill="#3b82f6" stroke="#fff" stroke-width="6"/></svg>`;
        vehicleMarker.current = new maplibregl.Marker({ element: el }).setLngLat(target).addTo(map.current);
    } else {
        vehicleMarker.current.setLngLat(target);
    }

    // 3. Camera
    if (autoCenter) {
        let zoom=17.5, b=map.current.getBearing(), p=0, tb=0;
        if (navigationActive) {
            p=45; zoom = speed*3.6<15 ? 20 : 18.5;
            if(heading>0) tb=heading;
            else if(routeCoords?.length>1) tb=bearing([routeCoords[0][1], routeCoords[0][0]], [routeCoords[1][1], routeCoords[1][0]]);
        }
        const diff=(tb-b+540)%360-180;
        const smoothB=b+diff*0.2;
        const arrow = vehicleMarker.current.getElement().querySelector('.v-arrow-svg') as HTMLElement;
        if(arrow) arrow.style.transform = `rotate(${tb - smoothB}deg)`;
        map.current.easeTo({ center: target, zoom, bearing: smoothB, pitch: p, duration: 800, easing: t=>t });
    }
  }, [center, speed, heading, navigationActive, route, autoCenter]);

  return (
    <div className={styles.mapWrapper}>
      <div ref={mapContainer} className={styles.mapContainerMain} />
      {navigationActive && guidance && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>{guidance.icon}</div>
          <div className={styles.guidanceText}>{guidance.text} ({guidance.dist}M)</div>
        </div>
      )}
      {!autoCenter && <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>🎯 RECENTRER</button>}
      <style>{`
        .v-arrow-container { width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5)); }
        .v-arrow-svg { width: 44px; height: 44px; transition: transform 0.1s linear; }
      `}</style>
    </div>
  );
}

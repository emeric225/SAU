import { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import styles from '../app/unit/unit.module.css';

// ─── Geo Zones ────────────────────────────────────────────────────────────────
const sectors: any = {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { "name": "Zone Portuaire", "color": "#3b82f6" }, "geometry": { "type": "Polygon", "coordinates": [[[-4.01,5.30],[-3.99,5.30],[-3.99,5.28],[-4.01,5.28],[-4.01,5.30]]] } },
    { "type": "Feature", "properties": { "name": "Secteur Cocody North", "color": "#e11d48" }, "geometry": { "type": "Polygon", "coordinates": [[[-3.98,5.38],[-3.95,5.38],[-3.95,5.35],[-3.98,5.35],[-3.98,5.38]]] } },
    { "type": "Feature", "properties": { "name": "Zone Industrielle Yopougon", "color": "#f97316" }, "geometry": { "type": "Polygon", "coordinates": [[[-4.08,5.35],[-4.04,5.35],[-4.04,5.32],[-4.08,5.32],[-4.08,5.35]]] } },
  ]
};

// ─── Leaflet icon fix ─────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

// ─── Pure utils ───────────────────────────────────────────────────────────────
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
  // 1. Normalize apostrophes
  let r = text.replace(/\u2019|\u0027/g, "'");
  // 2. Remove cardinal directions (various OSRM formulations)
  r = r.replace(/(Prenez la direction|Head|Se diriger vers (l'|le |la )|Direction|Vers (l'|le |la ))(nord[\-\u2011]?est|nord[\-\u2011]?ouest|sud[\-\u2011]?est|sud[\-\u2011]?ouest|nord|sud|est|ouest)\s*(sur\s*)?(la\s+|le\s+|l')?/ig, 'CONTINUEZ SUR ');
  // 3. Translate left/right English
  r = r.replace(/Turn (left|right) onto /ig, (_,d) => d==='left' ? 'TOURNEZ \u00c0 GAUCHE SUR ' : 'TOURNEZ \u00c0 DROITE SUR ');
  // 4. Translate left/right French
  r = r.replace(/Tournez \u00e0 (gauche|droite) sur /ig, (_,d) => d==='gauche' ? 'TOURNEZ \u00c0 GAUCHE SUR ' : 'TOURNEZ \u00c0 DROITE SUR ');
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

function lerpAngle(a: number, b: number, t: number): number {
  let d=b-a; while(d>180)d-=360; while(d<-180)d+=360; return a+d*t;
}

function snapToRoad(gps: [number,number], coords: any[]): [number,number] {
  let best: [number,number]=gps, minD=Infinity;
  for(let i=0;i<coords.length-1;i++){
    const a: [number,number]=[coords[i].lat,coords[i].lng];
    const b: [number,number]=[coords[i+1].lat,coords[i+1].lng];
    const ab={x:b[0]-a[0],y:b[1]-a[1]}, ap={x:gps[0]-a[0],y:gps[1]-a[1]};
    const l2=ab.x**2+ab.y**2; if(l2===0){continue;}
    const t=Math.max(0,Math.min(1,(ap.x*ab.x+ap.y*ab.y)/l2));
    const proj:[number,number]=[a[0]+ab.x*t, a[1]+ab.y*t];
    const d=dist(gps,proj); if(d<minD){minD=d;best=proj;}
  }
  return minD<30 ? best : gps;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const VehicleIcon = (rot: number) => L.divIcon({
  className: '',
  html: `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;position:relative;">
    <!-- Outer pulse ring -->
    <div style="position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(239,68,68,0.2);animation:vp 1.5s ease-out infinite;"></div>
    <!-- Mid ring -->
    <div style="position:absolute;width:28px;height:28px;border-radius:50%;background:rgba(239,68,68,0.35);animation:vp 1.5s 0.5s ease-out infinite;"></div>
    <!-- Core dot -->
    <div style="position:absolute;width:16px;height:16px;border-radius:50%;background:#ef4444;border:2.5px solid #fff;box-shadow:0 0 12px rgba(239,68,68,0.9);"></div>
  </div>`,
  iconSize: [48,48], iconAnchor: [24,24],
});

const StationIcon = (status: string) => {
  const c = status==='busy'?'#f59e0b':status==='offline'||status==='unactive'?'#64748b':'#3b82f6';
  return L.divIcon({ className:'', html:`<div style="background:${c};width:28px;height:28px;border-radius:8px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px ${c}88;"><span style="font-size:12px;">🏠</span></div>`, iconSize:[28,28], iconAnchor:[14,14] });
};

const AlertIcon = (status: string, type: string) => {
  const c=status==='pending'?'#ef4444':'#fbbf24';
  const e=type==='fire'?'🔥':type==='medical'?'🚑':'🚗';
  return L.divIcon({ className:'', html:`<div style="background:${c};width:40px;height:40px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px ${c}99;${status==='pending'?'animation:ap 1s infinite;':''}"><span style="font-size:20px;">${e}</span></div>`, iconSize:[40,40], iconAnchor:[20,20] });
};

// ─── Routing machine ─────────────────────────────────────────────────────────
function RoutingMachine({ waypoints, onRoute }: { waypoints: L.LatLng[], onRoute:(r:any)=>void }) {
  const map = useMap();
  const cbRef = useRef(onRoute);
  const ctrlRef = useRef<any>(null);
  useEffect(()=>{ cbRef.current=onRoute; },[onRoute]);

  useEffect(()=>{
    if(!map||waypoints.length<2) return;
    if(!(L as any).Routing?.control) return;

    if(!ctrlRef.current){
      const ctrl=(L as any).Routing.control({
        waypoints,
        lineOptions:{ styles:[{color:'#3b82f6',opacity:0.9,weight:8},{color:'#93c5fd',opacity:0.3,weight:14}], extendToWaypoints:true, missingRouteTolerance:10 },
        createMarker:()=>null, addWaypoints:false, draggableWaypoints:false, fitSelectedRoutes:false, show:false,
        router:(L as any).Routing.osrmv1({ serviceUrl:'https://router.project-osrm.org/route/v1', profile:'driving', language:'fr' }),
        formatter: new (L as any).Routing.Formatter({ language:'fr' }),
      });
      ctrl.addTo(map);
      ctrlRef.current=ctrl;
      ctrl.on('routesfound',(e:any)=>{ if(e.routes?.length) cbRef.current(e.routes[0]); });
    } else {
      const cur=ctrlRef.current.getWaypoints();
      const d0=cur[0]?.latLng?dist([cur[0].latLng.lat,cur[0].latLng.lng],[waypoints[0].lat,waypoints[0].lng]):999;
      const d1=cur[1]?.latLng?dist([cur[1].latLng.lat,cur[1].latLng.lng],[waypoints[1].lat,waypoints[1].lng]):999;
      if(d0>50||d1>5) ctrlRef.current.setWaypoints(waypoints);
    }
  },[map, waypoints]);

  return null;
}

// ─── Map controller (inside MapContainer) ────────────────────────────────────
// KEY INSIGHT: We keep the vehicle at the CENTER of the screen. The CSS wrapper
// rotates around 50%/50% = the vehicle = perfect course-up rotation.
// For the "vehicle lower on screen" effect, we use a Leaflet pixel offset:
// panTo projects the vehicle position and shifts it UP by OFFSET_PX so that
// when Leaflet centres on that shifted point, the vehicle renders lower.
const OFFSET_PX = 80; // pixels below center (vehicle appears 80px below middle)

function MapController({ target, active, autoCenter, speed }: {
  target: [number,number]; active: boolean; autoCenter: boolean; speed: number;
}) {
  const map = useMap();

  useMapEvents({
    dragstart: ()=> window.dispatchEvent(new CustomEvent('sau-dragged')),
    zoomstart: ()=> window.dispatchEvent(new CustomEvent('sau-dragged')),
  });

  useEffect(()=>{
    if(!autoCenter||!map) return;

    // Adaptive zoom
    let zoom=17;
    if(active){
      const kmh=speed*3.6;
      if(kmh<8) zoom=19; else if(kmh<30) zoom=18; else if(kmh<60) zoom=17; else zoom=16;
    } else { zoom=15; }
    if(Math.abs(map.getZoom()-zoom)>0.5) map.setZoom(zoom,{animate:false});

    // Offset pan: move map so vehicle appears OFFSET_PX below center
    if(active){
      const z=map.getZoom();
      const vPx=map.project(target,z);
      // shift center UP by OFFSET_PX → vehicle will render OFFSET_PX below map center
      const centerPx=L.point(vPx.x, vPx.y - OFFSET_PX);
      const centerLL=map.unproject(centerPx,z);
      map.panTo(centerLL,{animate:true,duration:0.35,easeLinearity:0.2});
    } else {
      map.panTo(target,{animate:true,duration:0.5,easeLinearity:0.2});
    }
  },[target, map, active, autoCenter, speed]);

  return null;
}

// ─── Main Map ─────────────────────────────────────────────────────────────────
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
  const [lrmReady, setLrmReady] = useState(false);
  useEffect(()=>{
    if(typeof window==='undefined') return;
    (window as any).L=L;
    import('leaflet-routing-machine').then(()=>setLrmReady(true));
  },[]);

  // ── Smooth position via RAF ────────────────────────────────────────────────
  const markerRef    = useRef<any>(null);
  const mapDivRef    = useRef<HTMLDivElement>(null); // direct DOM ref for rotation
  const targetRef    = useRef<[number,number]>(center);
  const lerpRef      = useRef<[number,number]>(center);
  const prevGpsRef   = useRef<[number,number]>(center);
  const [lerpPos, setLerpPos] = useState<[number,number]>(center);

  // ── Bearing — only refs, NO state (avoids 60 re-renders/s) ───────────────
  const rawBearRef    = useRef(0);
  const smoothBearRef = useRef(0);

  // ── Misc state ────────────────────────────────────────────────────────────
  const [route,    setRoute]    = useState<any>(null);
  const [guidance, setGuidance] = useState<{text:string;icon:string;dist:number}|null>(null);
  const [sigOk,    setSigOk]    = useState(true);
  const [autoC,    setAutoC]    = useState(true);
  const prevInstrRef = useRef('');
  const sigTimer    = useRef<any>(null);

  useEffect(()=>{
    const h=()=>setAutoC(false);
    window.addEventListener('sau-dragged',h);
    return ()=>window.removeEventListener('sau-dragged',h);
  },[]);

  // GPS signal watchdog
  useEffect(()=>{
    clearTimeout(sigTimer.current); setSigOk(true);
    sigTimer.current=setTimeout(()=>setSigOk(false),8000);
    return ()=>clearTimeout(sigTimer.current);
  },[center]);

  // Update target + bearing on new GPS
  useEffect(()=>{
    const gps: [number,number] = center;
    const prev = prevGpsRef.current;
    const d = dist(prev, gps);

    let newBearing: number | null = null;

    // Priority 1: Real GPS heading sensor (most accurate)
    if(heading !== null && heading > 0 && speed > 0.5){
      newBearing = heading;
    }
    // Priority 2: Calculate from movement trajectory
    else if(d > 3){
      newBearing = bearing(prev, gps);
    }
    // Priority 3: Use next route segment geometry (works even stationary)
    else if(route?.coordinates?.length > 1){
      // Find the closest segment to current position, then use direction of next segment
      let minD = Infinity;
      let bestIdx = 0;
      const coords = route.coordinates;
      for(let i = 0; i < coords.length - 1; i++){
        const mid: [number,number] = [
          (coords[i].lat + coords[i+1].lat) / 2,
          (coords[i].lng + coords[i+1].lng) / 2,
        ];
        const d2 = dist(gps, mid);
        if(d2 < minD){ minD = d2; bestIdx = i; }
      }
      // Use the segment ahead
      const ahead = Math.min(bestIdx + 1, coords.length - 2);
      const p1: [number,number] = [coords[ahead].lat, coords[ahead].lng];
      const p2: [number,number] = [coords[ahead+1].lat, coords[ahead+1].lng];
      newBearing = bearing(p1, p2);
    }

    if(newBearing !== null){
      rawBearRef.current = newBearing;
    }

    prevGpsRef.current = gps;
    targetRef.current = gps;
  },[center, heading, speed, route]);

  // Single RAF loop: position LERP + bearing LERP — direct DOM, no setState
  useEffect(()=>{
    let raf: number;
    let lastT=performance.now();

    const tick=(t: number)=>{
      const dt=Math.min(t-lastT,50); lastT=t;

      // Position lerp
      const cur=lerpRef.current, tgt=targetRef.current;
      const alpha=Math.min(dt*0.007,1);
      const next: [number,number]=[
        cur[0]+(tgt[0]-cur[0])*alpha,
        cur[1]+(tgt[1]-cur[1])*alpha,
      ];
      const moved=Math.abs(next[0]-cur[0])>1e-9||Math.abs(next[1]-cur[1])>1e-9;
      if(moved){
        lerpRef.current=next;
        // DO NOT touch markerRef — React owns marker position via `center` prop
        setLerpPos([...next]); // only used for MapController smooth pan
      }

      // Bearing lerp — update DOM directly, no React re-render
      const prev=smoothBearRef.current;
      smoothBearRef.current=lerpAngle(prev, rawBearRef.current, 0.08);
      const diff=Math.abs(smoothBearRef.current-prev);
      if(diff>0.05 && mapDivRef.current){
        // Positive bearing = clockwise rotation of map → route direction goes UP
        const rot = smoothBearRef.current;
        mapDivRef.current.style.transform=`rotate(${rot}deg)`;
      }

      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[]); // runs forever — stable refs only

  // Guidance banner
  useEffect(()=>{
    if(!route?.instructions?.length) return;
    const i=route.instructions[0];
    if(!i?.text) return;
    if(i.text!==prevInstrRef.current){
      prevInstrRef.current=i.text;
      window.dispatchEvent(new CustomEvent('sau-nav-instruction'));
    }
    setGuidance({text:cleanInstruction(i.text), icon:getManeuverIcon(i.type,i.modifier), dist:Math.round(i.distance)});
  },[route]);

  const waypoints = useMemo(()=>{
    if(!selectedAlert||selectedAlert.lat==null) return [];
    try{ return [L.latLng(center[0],center[1]),L.latLng(selectedAlert.lat,selectedAlert.lng)]; }
    catch{ return []; }
  },[center[0],center[1],selectedAlert?.id]);

  return (
    <div className={styles.mapWrapper}>

      {/* Guidance banner — outside the rotating div, stays horizontal ✓ */}
      {navigationActive && guidance && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>{guidance.icon}</div>
          <div className={styles.guidanceText}>{guidance.text} ({guidance.dist}M)</div>
          {!sigOk && <div className={styles.weakSignal}>SIG.</div>}
        </div>
      )}

      {/* Map wrapper — rotates around screen center = vehicle position */}
      {/* transform set initially here; RAF updates it directly via mapDivRef */}
      <div
        ref={mapDivRef}
        style={{
          position:'absolute', inset:0,
          transform:'rotate(0deg)',
          transformOrigin:'50% 50%',
          willChange:'transform',
        }}
      >
        <MapContainer center={center} zoom={17} scrollWheelZoom={false} zoomControl={false} className={styles.mapContainerMain}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO"/>

          <GeoJSON
            data={sectors}
            style={(f:any)=>({fillColor:f?.properties.color, weight:1, opacity:0.3, color:f?.properties.color, fillOpacity:0.1, dashArray:'5,5'})}
            onEachFeature={(f,l)=>{ if(f.properties?.name) l.bindTooltip(f.properties.name,{permanent:true,direction:'center',className:'cztt'}); }}
          />

          <MapController target={lerpPos} active={navigationActive} autoCenter={autoC} speed={speed}/>

          {isLiveUnitMode && selectedAlert && lrmReady && (
            <RoutingMachine waypoints={waypoints} onRoute={(r)=>{
              setRoute(r);
              onRouteDataReady?.({distanceKm:r.summary.totalDistance/1000, durationMin:r.summary.totalTime/60});
            }}/>
          )}

          {stations.map(s=><Marker key={s.id} position={[s.lat,s.lng]} icon={StationIcon(s.status)}/>)}
          {alerts.map(a=>(
            <Marker key={a.id} position={[a.lat,a.lng]} icon={AlertIcon(a.status,a.type)}>
              <Popup><strong>{a.type?.toUpperCase()}</strong></Popup>
            </Marker>
          ))}

          <Marker
            position={center}
            ref={markerRef}
            icon={VehicleIcon(0)}
            zIndexOffset={1000}
          />
          {units.filter(u=>u.id!==selfUnitId).map(u=>(
            <Marker key={u.id} position={[u.lat,u.lng]} icon={VehicleIcon(0)}/>
          ))}
        </MapContainer>
      </div>

      {!autoC && (
        <button onClick={()=>setAutoC(true)} className={styles.tacticalRecenterBtn} style={{zIndex:6000}}>
          🎯 RECENTRER
        </button>
      )}

      <style>{`
        .cztt { background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.2); border-radius:4px; color:#fff; font-size:10px; padding:2px 6px; }
        .leaflet-routing-container { display:none!important; }
        @keyframes sf { from{opacity:0.2}to{opacity:1;filter:brightness(1.5)} }
        @keyframes ap { 0%{transform:scale(1)}50%{transform:scale(1.1);opacity:0.8}100%{transform:scale(1)} }
        @keyframes vp { 0%{transform:scale(0.6);opacity:0.8} 100%{transform:scale(1.8);opacity:0} }
      `}</style>
    </div>
  );
}

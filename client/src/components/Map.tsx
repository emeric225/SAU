import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// LRM CSS are imported here
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import styles from '../app/unit/unit.module.css';

// POINT 3 & 11: Operational Zones (GeoJSON)
const sectors: any = {
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "name": "Zone Portuaire", "color": "#3b82f6" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[ -4.01, 5.30 ], [ -3.99, 5.30 ], [ -3.99, 5.28 ], [ -4.01, 5.28 ], [ -4.01, 5.30 ]]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Secteur Cocody North", "color": "#e11d48" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[ -3.98, 5.38 ], [ -3.95, 5.38 ], [ -3.95, 5.35 ], [ -3.98, 5.35 ], [ -3.98, 5.38 ]]]
      }
    },
    {
      "type": "Feature",
      "properties": { "name": "Zone Industrielle Yopougon", "color": "#f97316" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[ -4.08, 5.35 ], [ -4.04, 5.35 ], [ -4.04, 5.32 ], [ -4.08, 5.32 ], [ -4.08, 5.35 ]]]
      }
    }
  ]
};

// Fix for default Leaflet icons
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

// --- Utils ---
export const getManeuverIcon = (type: string, modifier: string) => {
  if (type === 'Straight') return '⬆️';
  if (type === 'Uturn') return '🔄';
  if (modifier === 'Left') return '⬅️';
  if (modifier === 'Right') return '➡️';
  if (modifier === 'SharpLeft') return '↙️';
  if (modifier === 'SharpRight') return '↘️';
  if (modifier === 'SlightLeft') return '↖️';
  if (modifier === 'SlightRight') return '↗️';
  return '⬆️';
};

export const cleanInstruction = (text: string) => {
  if (!text) return '';
  // Traduction et nettoyage agressif
  let res = text.replace(/Head (north|south|east|west|northeast|northwest|southeast|southwest) on /ig, 'CONTINUEZ SUR ');
  res = res.replace(/Prenez la direction (nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest) sur /ig, 'CONTINUEZ SUR ');
  res = res.replace(/Turn (left|right) onto /ig, (m, dir) => dir === 'left' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  res = res.replace(/Tournez à (gauche|droite) sur /ig, (m, dir) => dir === 'gauche' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  return res.toUpperCase();
};

// --- Icons ---
const VehicleIcon = (rotation: number, status: string) => L.divIcon({
  className: 'custom-vehicle-icon',
  html: `<div style="transform: rotate(${rotation}deg); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
      <svg width="44" height="44" viewBox="0 0 24 24" style="filter: drop-shadow(0 0 10px rgba(225,29,72,0.8));">
        <path d="M12 2L4 20L12 17L20 20L12 2Z" fill="url(#gradUnit)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
        <defs>
          <linearGradient id="gradUnit" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#e11d48;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#be123c;stop-opacity:1" />
          </linearGradient>
        </defs>
      </svg>
      <div style="position: absolute; font-size: 16px;">${status === 'en_route' ? '🚒' : '📍'}</div>
      ${status === 'en_route' ? `
      <div style="position: absolute; top: 0px; left: 8px; width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 12px #3b82f6; animation: siren-flash 0.3s infinite alternate;"></div>
      <div style="position: absolute; top: 0px; right: 8px; width: 8px; height: 8px; background: #e11d48; border-radius: 50%; box-shadow: 0 0 12px #e11d48; animation: siren-flash 0.3s 0.15s infinite alternate;"></div>
      ` : ''}
    </div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

const StationIcon = (status: string, invRot: number) => {
  let color = '#3b82f6';
  if (status === 'busy') color = '#f59e0b';
  if (status === 'offline' || status === 'unactive') color = '#64748b';
  return L.divIcon({
    className: 'custom-station-icon',
    html: `<div style="transform: rotate(${invRot}deg); background: ${color}; width: 32px; height: 32px; border-radius: 10px; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${color}66;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const AlertIcon = (status: string, type: string, invRot: number) => L.divIcon({
  className: 'custom-alert-icon',
  html: `<div style="transform: rotate(${invRot}deg); background: ${status === 'pending' ? '#e11d48' : '#fbbf24'}; width: 42px; height: 42px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px ${status === 'pending' ? 'rgba(225,29,72,0.7)' : 'rgba(251,191,36,0.7)'}; ${status === 'pending' ? 'animation: alert-pulse 1s infinite;' : ''}">
          <span style="font-size: 22px;">${type === 'fire' ? '🔥' : type === 'medical' ? '🚑' : '🚗'}</span>
        </div>`,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

// --- Utils ---
function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getClosestPointOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const atob = { x: b[0] - a[0], y: b[1] - a[1] };
  const atop = { x: p[0] - a[0], y: p[1] - a[1] };
  const len2 = atob.x * atob.x + atob.y * atob.y;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, (atop.x * atob.x + atop.y * atob.y) / len2));
  return [a[0] + atob.x * t, a[1] + atob.y * t];
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * t;
}

// --- Components ---

function RoutingMachine({ waypoints, onRouteUpdate, active }: { waypoints: L.LatLng[], onRouteUpdate: (data: any) => void, active: boolean }) {
  const map = useMap();
  const callbackRef = useRef(onRouteUpdate);
  const routingControlRef = useRef<any>(null);
  useEffect(() => { callbackRef.current = onRouteUpdate; }, [onRouteUpdate]);

  useEffect(() => {
    if (!map || !active || !waypoints || waypoints.length < 2) return;

    if (typeof window !== 'undefined') {
      (window as any).L = L;
    }

    if (!(L as any).Routing || !(L as any).Routing.control) {
      console.warn('[RoutingMachine] L.Routing not ready');
      return;
    }

    // Reuse existing control if possible
    let ctrl = routingControlRef.current;

    if (!ctrl) {
      ctrl = (L as any).Routing.control({
        waypoints: waypoints,
        lineOptions: {
          styles: [
            { color: '#3b82f6', opacity: 0.8, weight: 8 },
            { color: '#60a5fa', opacity: 0.4, weight: 12 }
          ],
          extendToWaypoints: true,
          missingRouteTolerance: 10
        },
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        show: false,
        router: (L as any).Routing.osrmv1({
          serviceUrl: 'https://router.project-osrm.org/route/v1',
          profile: 'driving',
          language: 'fr'
        }),
        formatter: new (L as any).Routing.Formatter({ language: 'fr' })
      });
      
      ctrl.addTo(map);
      routingControlRef.current = ctrl;

      ctrl.on('routesfound', function(e: any) {
        if (e.routes && e.routes.length > 0) {
          callbackRef.current(e.routes[0]);
        }
      });
    } else {
      const current = ctrl.getWaypoints();
      const startDist = current[0]?.latLng ? distanceMeters([current[0].latLng.lat, current[0].latLng.lng], [waypoints[0].lat, waypoints[0].lng]) : 999;
      const destDist = current[1]?.latLng ? distanceMeters([current[1].latLng.lat, current[1].latLng.lng], [waypoints[1].lat, waypoints[1].lng]) : 999;

      if (startDist > 50 || destDist > 5) {
        ctrl.setWaypoints(waypoints);
      }
    }

    return () => {
      // Logic for cleanup handled by parent if needed, but here we can at least remove it if active prop changes
    };
  }, [map, waypoints, active]); // onRouteUpdate removed from deps as it's in a ref

  return null;
}


function MapRecenter({ center, navigationActive, autoCenter, speed }: { center: [number, number]; navigationActive: boolean; autoCenter: boolean; speed: number }) {
  const map = useMap();

  useMapEvents({
    dragstart: () => {
      window.dispatchEvent(new CustomEvent('sau-manual-drag'));
    },
    zoomstart: () => {
      window.dispatchEvent(new CustomEvent('sau-manual-drag'));
    }
  });

  useEffect(() => {
    if (!autoCenter || !map) return;

    let targetZoom = 16;
    if (navigationActive) {
      const speedKmh = speed * 3.6;
      if (speedKmh < 10) targetZoom = 20; // Zoom max +
      else if (speedKmh < 40) targetZoom = 19;
      else if (speedKmh < 80) targetZoom = 17;
      else targetZoom = 16;
    } else {
      targetZoom = 15;
    }

    if (map.getZoom() !== targetZoom) {
      map.setZoom(targetZoom, { animate: true });
    }

    // Ciblage direct de la position lissée (center est ici vehiclePos qui est LERPed)
    map.panTo(center, { animate: true, duration: 0.5, easeLinearity: 0.1 });
  }, [center, map, navigationActive, autoCenter, speed]);

  return null;
}

// --- Main Map Component ---
interface MapProps {
  stations: any[];
  alerts: any[];
  center?: [number, number]; // This is used as raw GPS pos
  selectedAlert?: any;
  navigationActive?: boolean;
  onRouteDataReady?: (data: any) => void;
  units?: any[];
  isLiveUnitMode?: boolean;
  selfUnitId?: string;
  speed?: number;
  heading?: number;
}

export default function Map({
  stations,
  alerts,
  center = [5.3365, -4.0268],
  selectedAlert,
  navigationActive = false,
  onRouteDataReady,
  units = [],
  isLiveUnitMode = false,
  selfUnitId,
  speed = 0,
  heading = 0
}: MapProps) {
  const [lrmReady, setLrmReady] = useState(false);
  const [windowHeight, setWindowHeight] = useState(800);

  useEffect(() => {
    setWindowHeight(window.innerHeight || 800);
    if (typeof window !== 'undefined') {
      (window as any).L = L;
      // @ts-ignore
      import('leaflet-routing-machine').then(() => {
        setLrmReady(true);
      });
    }
  }, []);

  const [vehiclePos, setVehiclePos] = useState<[number, number]>(center);
  const [rotation, setRotation] = useState(0);
  const [smoothRotation, setSmoothRotation] = useState(0);
  const [autoCenter, setAutoCenter] = useState(true);
  const [route, setRoute] = useState<any>(null);
  useEffect(() => {
    const handleDrag = () => setAutoCenter(false);
    window.addEventListener('sau-manual-drag', handleDrag);
    return () => window.removeEventListener('sau-manual-drag', handleDrag);
  }, []);

  const [guidanceObj, setGuidanceObj] = useState<{ text: string, icon: string, distance: number } | null>(null);
  const [signalStatus, setSignalStatus] = useState<'solid' | 'weak'>('solid');

  const rotationRef = useRef(0);
  const markerRef = useRef<any>(null);
  const targetPosRef = useRef<[number, number]>(center);
  const currentLerpPosRef = useRef<[number, number]>(center);

  const prevInstrTextRef = useRef<string>('');
  const lastCenterUpdateRef = useRef(center);
  const gpsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (gpsTimeoutRef.current) clearTimeout(gpsTimeoutRef.current);
    setSignalStatus('solid');
    gpsTimeoutRef.current = setTimeout(() => {
      setSignalStatus('weak');
    }, 6000);
    return () => { if (gpsTimeoutRef.current) clearTimeout(gpsTimeoutRef.current); };
  }, [center]);

  useEffect(() => {
    const targetGPS = center;
    const prevPos = lastCenterUpdateRef.current;
    
    let snappedPos: [number, number] = targetGPS;
    if (isLiveUnitMode && navigationActive && route && route.coordinates) {
      let minDist = Infinity;
      let bestProj: [number, number] = targetGPS;
      
      const coords = route.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const p1: [number, number] = [coords[i].lat, coords[i].lng];
        const p2: [number, number] = [coords[i+1].lat, coords[i+1].lng];
        const proj = getClosestPointOnSegment(targetGPS, p1, p2);
        const dist = distanceMeters(targetGPS, proj);
        if (dist < minDist) {
          minDist = dist;
          bestProj = proj;
        }
      }
      
      if (minDist < 30) {
        snappedPos = bestProj;
      }
    }

    const distForHeading = distanceMeters(prevPos, snappedPos);
    if (distForHeading > 1.5) {
      const bear = calcBearing(prevPos, snappedPos);
      setRotation(bear);
    }

    targetPosRef.current = snappedPos;
    // On ne met plus à jour vehiclePos ici directement pour laisser le LERP s'en occuper
    lastCenterUpdateRef.current = snappedPos;
  }, [center, isLiveUnitMode, navigationActive, route]);

  // Marker RequestAnimationFrame LERP (for ultra-smooth movement) & Smooth Rotation Filter
  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();

    const step = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      // Position LERP
      const currentPos = currentLerpPosRef.current;
      const targetPos = targetPosRef.current;
      const dLat = targetPos[0] - currentPos[0];
      const dLng = targetPos[1] - currentPos[1];
      
      const lerpFactor = Math.min(dt * 0.005, 1);
      
      if (Math.abs(dLat) > 0.000001 || Math.abs(dLng) > 0.000001) {
        currentLerpPosRef.current = [currentPos[0] + dLat * lerpFactor, currentPos[1] + dLng * lerpFactor];
        if (markerRef.current) {
          markerRef.current.setLatLng(currentLerpPosRef.current);
        }
        // Force le MapRecenter à suivre la position LERP pour un pivot mathématiquement stable
        setVehiclePos(currentLerpPosRef.current); 
      }

      // Rotation LERP
      rotationRef.current = lerpAngle(rotationRef.current, rotation, 0.1);
      setSmoothRotation(rotationRef.current);

      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [rotation]);

  function calcBearing(p1: [number, number], p2: [number, number]): number {
    const dLon = (p2[1] - p1[1]) * (Math.PI / 180);
    const lat1 = p1[0] * (Math.PI / 180);
    const lat2 = p2[0] * (Math.PI / 180);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.atan2(y, x) * (180 / Math.PI);
  }

  // Guidance Banner update (Icon/text extraction)
  useEffect(() => {
    if (route && route.instructions) {
      const instr = route.instructions[0];
      if (instr && instr.text) {
        if (instr.text !== prevInstrTextRef.current) {
          prevInstrTextRef.current = instr.text;
          window.dispatchEvent(new CustomEvent('sau-nav-instruction'));
        }
        setGuidanceObj({
          text: cleanInstruction(instr.text),
          icon: getManeuverIcon(instr.type, instr.modifier),
          distance: Math.round(instr.distance)
        });
      }
    }
  }, [route]);

  const routingWaypoints = useMemo(() => {
    if (!selectedAlert || !center || selectedAlert.lat === undefined || selectedAlert.lng === undefined) return [];
    try {
      return [
        L.latLng(center[0], center[1]),
        L.latLng(selectedAlert.lat, selectedAlert.lng)
      ];
    } catch (e) { 
      console.error('[Map] Waypoints creation failed', e);
      return []; 
    }
  }, [center[0], center[1], selectedAlert?.id, selectedAlert?.lat]);

  const mapRotation = (navigationActive && autoCenter) ? -smoothRotation : 0;
  const invRot = (navigationActive && autoCenter) ? smoothRotation : 0;

  return (
    <div className={styles.mapWrapper}>
      {/* Dynamic Maneuver Guidance Banner */}
      {(navigationActive || (isLiveUnitMode && selectedAlert)) && guidanceObj && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>{guidanceObj.icon}</div>
          <div className={styles.guidanceText}>{guidanceObj.text} ({guidanceObj.distance}M)</div>
          {signalStatus === 'weak' && <div className={styles.weakSignal}>SIG.</div>}
        </div>
      )}

      {/* Auto-Rotating Oversized Map Container */}
      <div style={{
        position: 'absolute',
        width: '300vmax', height: '300vmax',
        top: '50%', left: '50%',
        // Shift map DOWN by 12vh to place vehicle at ~38% from bottom (above ETA bar)
        transform: `translate(-50%, calc(-50% + ${navigationActive ? '12vh' : '0vh'})) rotate(${mapRotation}deg)`,
        transformOrigin: '50% 50%',
        transition: 'transform 0.4s cubic-bezier(0.1, 0, 0.3, 1)'
      }}>
        <MapContainer center={center} zoom={14} scrollWheelZoom={true} zoomControl={false} className={styles.mapContainerMain}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO" />
          
          <GeoJSON 
             data={sectors} 
             style={(feature: any) => ({
               fillColor: feature?.properties.color,
               weight: 1,
               opacity: 0.3,
               color: feature?.properties.color,
               fillOpacity: 0.1,
               dashArray: '5, 5'
             })}
             onEachFeature={(feature, layer) => {
               if (feature.properties && feature.properties.name) {
                 layer.bindTooltip(feature.properties.name, {
                   permanent: true,
                   direction: 'center',
                   className: 'custom-zone-tooltip',
                 });
               }
             }}
          />
          
          <MapRecenter 
            center={vehiclePos} 
            navigationActive={navigationActive} 
            autoCenter={autoCenter} 
            speed={speed || 0}
          />

          {isLiveUnitMode && selectedAlert && lrmReady && (
            <RoutingMachine 
              waypoints={routingWaypoints} 
              active={lrmReady}
              onRouteUpdate={(r) => {
                setRoute(r);
                onRouteDataReady?.({ distanceKm: r.summary.totalDistance / 1000, durationMin: r.summary.totalTime / 60 });
              }}
            />
          )}

          {stations.map(s => (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={StationIcon(s.status, invRot)} />
          ))}

          {alerts.map(a => (
            <Marker key={a.id} position={[a.lat, a.lng]} icon={AlertIcon(a.status, a.type, invRot)}>
              <Popup><strong>{a.type.toUpperCase()}</strong></Popup>
            </Marker>
          ))}

          <Marker 
            position={center} 
            ref={markerRef}
            icon={VehicleIcon(smoothRotation, navigationActive ? 'en_route' : 'idle')} 
            zIndexOffset={1000}
          />

          {units.filter(u => u.id !== selfUnitId).map(u => (
            <Marker key={u.id} position={[u.lat, u.lng]} icon={VehicleIcon(0, 'idle')} />
          ))}
        </MapContainer>
      </div>

      {/* Recenter Button Layer (shown only if dragged out) */}
      {!autoCenter && (
        <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>
          🎯 RECENTRER
        </button>
      )}

      <style>{`
        /* Remove explicit marker transition so requestAnimationFrame works instantly */
        .custom-zone-tooltip {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          color: white;
          font-weight: 500;
          font-size: 10px;
          padding: 2px 6px;
          backdrop-filter: blur(4px);
        }
        @keyframes siren-flash { from { opacity: 0.2; } to { opacity: 1; filter: brightness(1.5); } }
        @keyframes alert-pulse { 0% { scale: 1; } 50% { scale: 1.1; opacity: 0.8; } 100% { scale: 1; } }
      `}</style>
    </div>
  );
}

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

// --- Icons ---
const VehicleIcon = (rotation: number, status: string) => L.divIcon({
  className: 'custom-vehicle-icon',
  html: `<div style="transform: rotate(${rotation}deg); transition: transform 0.3s ease-out; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
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

const StationIcon = (status: string) => {
  let color = '#3b82f6';
  if (status === 'busy') color = '#f59e0b';
  if (status === 'offline' || status === 'unactive') color = '#64748b';
  return L.divIcon({
    className: 'custom-station-icon',
    html: `<div style="background: ${color}; width: 32px; height: 32px; border-radius: 10px; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${color}66;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const AlertIcon = (status: string, type: string) => L.divIcon({
  className: 'custom-alert-icon',
  html: `<div style="background: ${status === 'pending' ? '#e11d48' : '#fbbf24'}; width: 42px; height: 42px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px ${status === 'pending' ? 'rgba(225,29,72,0.7)' : 'rgba(251,191,36,0.7)'}; ${status === 'pending' ? 'animation: alert-pulse 1s infinite;' : ''}">
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
          profile: 'driving'
        })
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


function MapRecenter({ center, navigationActive, autoCenter, setAutoCenter, speed }: { center: [number, number]; navigationActive: boolean; autoCenter: boolean; setAutoCenter: (v: boolean) => void, speed: number }) {
  const map = useMap();

  useMapEvents({
    dragstart: () => setAutoCenter(false),
    zoomstart: () => setAutoCenter(false)
  });

  useEffect(() => {
    if (!autoCenter || !map) return;

    // Zoom adaptatif
    let targetZoom = 15;
    if (navigationActive) {
      const speedKmh = speed * 3.6;
      if (speedKmh < 10) targetZoom = 19;
      else if (speedKmh < 40) targetZoom = 18;
      else if (speedKmh < 80) targetZoom = 16;
      else targetZoom = 15;
    } else {
      targetZoom = 14;
    }

    if (map.getZoom() !== targetZoom) {
      map.setZoom(targetZoom, { animate: true });
    }

    // Offset: Placer le véhicule en bas à 1/4 (75% du haut)
    if (navigationActive) {
      const point = map.project(center, map.getZoom());
      const offset = map.getSize().y / 4; // Shift up by 1/4 of screen height
      const targetPoint = point.subtract([0, offset]);
      const targetLatLng = map.unproject(targetPoint, map.getZoom());
      map.panTo(targetLatLng, { animate: true, duration: 1.2, easeLinearity: 0.1 });
    } else {
      map.panTo(center, { animate: true, duration: 0.8 });
    }
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

  // Safe import for Leaflet Routing Machine
  useEffect(() => {
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
  const [guidance, setGuidance] = useState<string | null>(null);
  const [signalStatus, setSignalStatus] = useState<'solid' | 'weak'>('solid');

  const rotationRef = useRef(0);
  const lastCenterUpdateRef = useRef(center);
  const lastTimeRef = useRef(Date.now());
  const gpsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor GPS Health
  useEffect(() => {
    if (gpsTimeoutRef.current) clearTimeout(gpsTimeoutRef.current);
    setSignalStatus('solid');
    gpsTimeoutRef.current = setTimeout(() => {
      setSignalStatus('weak');
    }, 6000);
    return () => { if (gpsTimeoutRef.current) clearTimeout(gpsTimeoutRef.current); };
  }, [center]);

  // LERP & Snapping Logic
  useEffect(() => {
    const targetGPS = center;
    const prevPos = lastCenterUpdateRef.current;
    
    // Snapping
    let snappedPos: [number, number] = targetGPS;
    if (isLiveUnitMode && navigationActive && route && route.coordinates) {
      let minDist = Infinity;
      let bestProj: [number, number] = targetGPS;
      
      // Opti: check segments near current index if possible, here we search all for robust snapping
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
      
      // If within 30m of a road, snap it. Otherwise keep raw GPS.
      if (minDist < 30) {
        snappedPos = bestProj;
      }
    }

    // Auto-Rotation (Bearing)
    const distForHeading = distanceMeters(prevPos, snappedPos);
    if (distForHeading > 1.5) { // Only update rotation if moved significantly
      const bear = calcBearing(prevPos, snappedPos);
      setRotation(bear);
    }

    // Direct update (CSS handles the 1s smooth glide)
    setVehiclePos(snappedPos);
    lastCenterUpdateRef.current = snappedPos;

  }, [center, isLiveUnitMode, navigationActive, route]);

  // Smooth rotation filter
  useEffect(() => {
    let rafId: number;
    const step = () => {
      rotationRef.current = lerpAngle(rotationRef.current, rotation, 0.1);
      setSmoothRotation(rotationRef.current);
      if (Math.abs(rotationRef.current - rotation) > 0.1) {
        rafId = requestAnimationFrame(step);
      }
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

  // Guidance Banner update
  useEffect(() => {
    if (route && route.instructions) {
      const instr = route.instructions[0];
      if (instr) {
        setGuidance(`${instr.text} (${Math.round(instr.distance)}m)`);
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

  return (
    <div className={styles.mapWrapper}>
      {/* Guidance Banner XXL */}
      {(navigationActive || (isLiveUnitMode && selectedAlert)) && guidance && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>⇅</div>
          <div className={styles.guidanceText}>{guidance.toUpperCase()}</div>
          {signalStatus === 'weak' && <div className={styles.weakSignal}>SIG. FAIBLE</div>}
        </div>
      )}

      <MapContainer center={center} zoom={14} scrollWheelZoom={true} zoomControl={false} className={styles.mapContainerMain}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO" />
        
        {/* POINT 11: Sector Zones */}
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
          setAutoCenter={setAutoCenter}
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

        {/* Stations */}
        {stations.map(s => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={StationIcon(s.status)} />
        ))}

        {/* Alerts */}
        {alerts.map(a => (
          <Marker key={a.id} position={[a.lat, a.lng]} icon={AlertIcon(a.status, a.type)}>
            <Popup><strong>{a.type.toUpperCase()}</strong></Popup>
          </Marker>
        ))}

        {/* Vehicle */}
        <Marker 
          position={vehiclePos} 
          icon={VehicleIcon(smoothRotation, navigationActive ? 'en_route' : 'idle')} 
          zIndexOffset={1000}
        />

        {/* Other Units */}
        {units.filter(u => u.id !== selfUnitId).map(u => (
          <Marker key={u.id} position={[u.lat, u.lng]} icon={VehicleIcon(0, 'idle')} />
        ))}
      </MapContainer>

      {!autoCenter && (
        <button onClick={() => setAutoCenter(true)} className={styles.tacticalRecenterBtn}>
          🎯 RECENTRER
        </button>
      )}

      <style>{`
        .leaflet-marker-icon { transition: transform 1s linear !important; }
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

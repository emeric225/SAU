import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import styles from '../app/unit/unit.module.css';

// ─── Geo Zones ────────────────────────────────────────────────────────────────
const sectors: any = {
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { "name": "Zone Portuaire", "color": "#3b82f6" }, "geometry": { "type": "Polygon", "coordinates": [[[ -4.01, 5.30 ], [ -3.99, 5.30 ], [ -3.99, 5.28 ], [ -4.01, 5.28 ], [ -4.01, 5.30 ]]] } },
    { "type": "Feature", "properties": { "name": "Secteur Cocody North", "color": "#e11d48" }, "geometry": { "type": "Polygon", "coordinates": [[[ -3.98, 5.38 ], [ -3.95, 5.38 ], [ -3.95, 5.35 ], [ -3.98, 5.35 ], [ -3.98, 5.38 ]]] } },
    { "type": "Feature", "properties": { "name": "Zone Industrielle Yopougon", "color": "#f97316" }, "geometry": { "type": "Polygon", "coordinates": [[[ -4.08, 5.35 ], [ -4.04, 5.35 ], [ -4.04, 5.32 ], [ -4.08, 5.32 ], [ -4.08, 5.35 ]]] } }
  ]
};

// ─── Leaflet Icon Fix ─────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
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
  let res = text.replace(/(Prenez la direction|Head|Se diriger vers le|Se diriger vers la|Direction|Vers) (nord|sud|est|ouest|nord-est|nord-ouest|sud-est|sud-ouest) sur (la |le )?/ig, 'CONTINUEZ SUR ');
  res = res.replace(/Turn (left|right) onto /ig, (_m, dir) => dir === 'left' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  res = res.replace(/Tournez à (gauche|droite) sur /ig, (_m, dir) => dir === 'gauche' ? 'TOURNEZ À GAUCHE SUR ' : 'TOURNEZ À DROITE SUR ');
  return res.toUpperCase();
};

function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcBearing(p1: [number, number], p2: [number, number]): number {
  const dLon = (p2[1] - p1[1]) * (Math.PI / 180);
  const lat1 = p1[0] * (Math.PI / 180);
  const lat2 = p2[0] * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * (180 / Math.PI)) + 360) % 360;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * t;
}

function getClosestPointOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const atob = { x: b[0] - a[0], y: b[1] - a[1] };
  const atop = { x: p[0] - a[0], y: p[1] - a[1] };
  const len2 = atob.x ** 2 + atob.y ** 2;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, (atop.x * atob.x + atop.y * atob.y) / len2));
  return [a[0] + atob.x * t, a[1] + atob.y * t];
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const VehicleIcon = (rotation: number, status: string) => L.divIcon({
  className: 'custom-vehicle-icon',
  html: `<div style="transform:rotate(${rotation}deg);width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;">
    <svg width="44" height="44" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 10px rgba(225,29,72,0.8));position:absolute;">
      <path d="M12 2L4 20L12 17L20 20L12 2Z" fill="#e11d48" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="position:absolute;font-size:14px;z-index:2;">${status === 'en_route' ? '🚒' : '📍'}</div>
    ${status === 'en_route' ? `
    <div style="position:absolute;top:0;left:8px;width:7px;height:7px;background:#3b82f6;border-radius:50%;box-shadow:0 0 12px #3b82f6;animation:siren-flash 0.3s infinite alternate;z-index:3;"></div>
    <div style="position:absolute;top:0;right:8px;width:7px;height:7px;background:#e11d48;border-radius:50%;box-shadow:0 0 12px #e11d48;animation:siren-flash 0.3s 0.15s infinite alternate;z-index:3;"></div>` : ''}
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
    html: `<div style="background:${color};width:32px;height:32px;border-radius:10px;border:2px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px ${color}66;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const AlertIcon = (status: string, type: string) => L.divIcon({
  className: 'custom-alert-icon',
  html: `<div style="background:${status === 'pending' ? '#e11d48' : '#fbbf24'};width:42px;height:42px;border-radius:50%;border:3px solid white;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px ${status === 'pending' ? 'rgba(225,29,72,0.7)' : 'rgba(251,191,36,0.7)'};${status === 'pending' ? 'animation:alert-pulse 1s infinite;' : ''}">
    <span style="font-size:22px;">${type === 'fire' ? '🔥' : type === 'medical' ? '🚑' : '🚗'}</span>
  </div>`,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoutingMachine({ waypoints, onRouteUpdate, active }: { waypoints: L.LatLng[], onRouteUpdate: (data: any) => void, active: boolean }) {
  const map = useMap();
  const callbackRef = useRef(onRouteUpdate);
  const controlRef = useRef<any>(null);
  useEffect(() => { callbackRef.current = onRouteUpdate; }, [onRouteUpdate]);

  useEffect(() => {
    if (!map || !active || waypoints.length < 2) return;
    if (!(L as any).Routing?.control) { console.warn('[LRM] Not ready'); return; }

    if (!controlRef.current) {
      const ctrl = (L as any).Routing.control({
        waypoints,
        lineOptions: { styles: [{ color: '#3b82f6', opacity: 0.85, weight: 9 }, { color: '#93c5fd', opacity: 0.35, weight: 14 }], extendToWaypoints: true, missingRouteTolerance: 10 },
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        show: false,
        router: (L as any).Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1', profile: 'driving', language: 'fr' }),
        formatter: new (L as any).Routing.Formatter({ language: 'fr' }),
      });
      ctrl.addTo(map);
      controlRef.current = ctrl;
      ctrl.on('routesfound', (e: any) => { if (e.routes?.length) callbackRef.current(e.routes[0]); });
    } else {
      const cur = controlRef.current.getWaypoints();
      const d0 = cur[0]?.latLng ? distanceMeters([cur[0].latLng.lat, cur[0].latLng.lng], [waypoints[0].lat, waypoints[0].lng]) : 999;
      const d1 = cur[1]?.latLng ? distanceMeters([cur[1].latLng.lat, cur[1].latLng.lng], [waypoints[1].lat, waypoints[1].lng]) : 999;
      if (d0 > 50 || d1 > 5) controlRef.current.setWaypoints(waypoints);
    }
  }, [map, waypoints, active]);

  return null;
}

// MapController = handles pan + zoom, lives INSIDE MapContainer
function MapController({ target, navigationActive, autoCenter, speed }: {
  target: [number, number]; navigationActive: boolean; autoCenter: boolean; speed: number;
}) {
  const map = useMap();

  useMapEvents({
    dragstart: () => window.dispatchEvent(new CustomEvent('sau-map-dragged')),
    zoomstart: () => window.dispatchEvent(new CustomEvent('sau-map-dragged')),
  });

  useEffect(() => {
    if (!autoCenter || !map) return;
    let zoom = 17;
    if (navigationActive) {
      const kmh = speed * 3.6;
      if (kmh < 10) zoom = 19;
      else if (kmh < 40) zoom = 18;
      else if (kmh < 80) zoom = 17;
      else zoom = 16;
    } else {
      zoom = 15;
    }
    if (map.getZoom() !== zoom) map.setZoom(zoom, { animate: false });
    map.panTo(target, { animate: true, duration: 0.4, easeLinearity: 0.15 });
  }, [target, map, navigationActive, autoCenter, speed]);

  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface MapProps {
  stations: any[];
  alerts: any[];
  center?: [number, number];
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
  stations, alerts,
  center = [5.3365, -4.0268],
  selectedAlert,
  navigationActive = false,
  onRouteDataReady,
  units = [],
  isLiveUnitMode = false,
  selfUnitId,
  speed = 0,
  heading = 0,
}: MapProps) {
  const [lrmReady, setLrmReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).L = L;
    import('leaflet-routing-machine').then(() => setLrmReady(true));
  }, []);

  // ── GPS / Position ──────────────────────────────────────────────────────────
  const markerRef = useRef<any>(null);
  const targetRef = useRef<[number, number]>(center);
  const lerpPosRef = useRef<[number, number]>(center);
  const prevPosRef = useRef<[number, number]>(center);
  const [lerpPos, setLerpPos] = useState<[number, number]>(center);

  // ── Rotation ────────────────────────────────────────────────────────────────
  const bearingRef = useRef(0);           // raw target bearing
  const smoothBearRef = useRef(0);        // lerped bearing for CSS
  const [mapBearing, setMapBearing] = useState(0); // triggers re-render for CSS

  // ── Other state ─────────────────────────────────────────────────────────────
  const [route, setRoute] = useState<any>(null);
  const [guidanceObj, setGuidanceObj] = useState<{ text: string; icon: string; distance: number } | null>(null);
  const [signalOk, setSignalOk] = useState(true);
  const [autoCenter, setAutoCenter] = useState(true);
  const prevInstrRef = useRef('');
  const signalTimerRef = useRef<any>(null);

  // Listen for manual map drag to disable auto-centre
  useEffect(() => {
    const handler = () => setAutoCenter(false);
    window.addEventListener('sau-map-dragged', handler);
    return () => window.removeEventListener('sau-map-dragged', handler);
  }, []);

  // ── GPS signal watchdog ────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(signalTimerRef.current);
    setSignalOk(true);
    signalTimerRef.current = setTimeout(() => setSignalOk(false), 6000);
    return () => clearTimeout(signalTimerRef.current);
  }, [center]);

  // ── Update target position + bearing on new GPS ────────────────────────────
  useEffect(() => {
    const gps = center;
    let snapped = gps;

    // Snap-to-road
    if (isLiveUnitMode && navigationActive && route?.coordinates?.length > 1) {
      let minD = Infinity;
      for (let i = 0; i < route.coordinates.length - 1; i++) {
        const p1: [number, number] = [route.coordinates[i].lat, route.coordinates[i].lng];
        const p2: [number, number] = [route.coordinates[i + 1].lat, route.coordinates[i + 1].lng];
        const proj = getClosestPointOnSegment(gps, p1, p2);
        const d = distanceMeters(gps, proj);
        if (d < minD) { minD = d; snapped = proj; }
      }
      if (distanceMeters(gps, snapped) > 30) snapped = gps; // too far off road
    }

    // Bearing: GPS heading takes priority, else calculate from movement
    const prev = prevPosRef.current;
    const moved = distanceMeters(prev, snapped);
    if (heading > 0 && speed > 1) {
      // GPS heading: 0=north, clockwise, no transformation needed
      bearingRef.current = heading;
    } else if (moved > 3) {
      bearingRef.current = calcBearing(prev, snapped);
    }

    prevPosRef.current = snapped;
    targetRef.current = snapped;
  }, [center, isLiveUnitMode, navigationActive, route, heading, speed]);

  // ── 60fps RAF: smooth position + bearing ──────────────────────────────────
  useEffect(() => {
    let raf: number;
    let lastT = performance.now();

    const tick = (t: number) => {
      const dt = Math.min(t - lastT, 50); // cap at 50ms to avoid jumps
      lastT = t;

      // Lerp position
      const cur = lerpPosRef.current;
      const tgt = targetRef.current;
      const alpha = Math.min(dt * 0.006, 1);
      const next: [number, number] = [
        cur[0] + (tgt[0] - cur[0]) * alpha,
        cur[1] + (tgt[1] - cur[1]) * alpha,
      ];
      const moved = Math.abs(next[0] - cur[0]) > 1e-8 || Math.abs(next[1] - cur[1]) > 1e-8;
      if (moved) {
        lerpPosRef.current = next;
        markerRef.current?.setLatLng(next);
        setLerpPos([...next]);
      }

      // Lerp bearing
      smoothBearRef.current = lerpAngle(smoothBearRef.current, bearingRef.current, 0.12);
      setMapBearing(smoothBearRef.current);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // no deps — runs once forever

  // ── Guidance banner ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!route?.instructions?.length) return;
    const instr = route.instructions[0];
    if (!instr?.text) return;
    if (instr.text !== prevInstrRef.current) {
      prevInstrRef.current = instr.text;
      window.dispatchEvent(new CustomEvent('sau-nav-instruction'));
    }
    setGuidanceObj({ text: cleanInstruction(instr.text), icon: getManeuverIcon(instr.type, instr.modifier), distance: Math.round(instr.distance) });
  }, [route]);

  // ── Routing waypoints ──────────────────────────────────────────────────────
  const waypoints = useMemo(() => {
    if (!selectedAlert || selectedAlert.lat == null) return [];
    try { return [L.latLng(center[0], center[1]), L.latLng(selectedAlert.lat, selectedAlert.lng)]; }
    catch { return []; }
  }, [center[0], center[1], selectedAlert?.id]);

  // ── CSS rotation values ────────────────────────────────────────────────────
  // The map container rotates by -bearing (to place north at top → bearing at top)
  const cssRotation = navigationActive ? -mapBearing : 0;

  return (
    <div className={styles.mapWrapper}>

      {/* ── Guidance Banner ──────────────────────────────────────────────── */}
      {navigationActive && guidanceObj && (
        <div className={styles.guidanceBanner}>
          <div className={styles.guidanceIcon}>{guidanceObj.icon}</div>
          <div className={styles.guidanceText}>{guidanceObj.text}  ({guidanceObj.distance}M)</div>
          {!signalOk && <div className={styles.weakSignal}>SIG.</div>}
        </div>
      )}

      {/* ── Rotating Map Wrapper ────────────────────────────────────────── */}
      {/*
        Strategy: We keep the map FULL SIZE but rotate it.
        The vehicle marker is at the exact centre of the MapContainer.
        We then shift the map DOWN by 15vh so the vehicle appears above
        the ETA bar, but the rotation pivot stays at the vehicle.
        To achieve this, we split the transform: shift then rotate.
      */}
      <div style={{
        position: 'absolute',
        // Make container large enough so rotation doesn't reveal background
        width: '300vmax',
        height: '300vmax',
        // Place pivot at logical vehicle position (50% across, 65% down = 35% from bottom)
        top: '65%',
        left: '50%',
        transform: `translate(-50%, -50%) rotate(${cssRotation}deg)`,
        transformOrigin: '50% 50%',
        transition: navigationActive ? 'transform 0.4s linear' : 'transform 0.6s ease-out',
        willChange: 'transform',
      }}>
        <MapContainer
          center={center}
          zoom={17}
          scrollWheelZoom={false}
          zoomControl={false}
          className={styles.mapContainerMain}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; CARTO"
          />

          <GeoJSON
            data={sectors}
            style={(f: any) => ({ fillColor: f?.properties.color, weight: 1, opacity: 0.3, color: f?.properties.color, fillOpacity: 0.1, dashArray: '5,5' })}
            onEachFeature={(f, layer) => {
              if (f.properties?.name) layer.bindTooltip(f.properties.name, { permanent: true, direction: 'center', className: 'custom-zone-tooltip' });
            }}
          />

          <MapController target={lerpPos} navigationActive={navigationActive} autoCenter={autoCenter} speed={speed} />

          {isLiveUnitMode && selectedAlert && lrmReady && (
            <RoutingMachine
              waypoints={waypoints}
              active={lrmReady}
              onRouteUpdate={(r) => {
                setRoute(r);
                onRouteDataReady?.({ distanceKm: r.summary.totalDistance / 1000, durationMin: r.summary.totalTime / 60 });
              }}
            />
          )}

          {stations.map(s => <Marker key={s.id} position={[s.lat, s.lng]} icon={StationIcon(s.status)} />)}

          {alerts.map(a => (
            <Marker key={a.id} position={[a.lat, a.lng]} icon={AlertIcon(a.status, a.type)}>
              <Popup><strong>{a.type?.toUpperCase()}</strong></Popup>
            </Marker>
          ))}

          {/* Vehicle marker — always at exact GPS position */}
          <Marker
            position={center}
            ref={markerRef}
            icon={VehicleIcon(mapBearing, navigationActive ? 'en_route' : 'idle')}
            zIndexOffset={1000}
          />

          {units.filter(u => u.id !== selfUnitId).map(u => (
            <Marker key={u.id} position={[u.lat, u.lng]} icon={VehicleIcon(0, 'idle')} />
          ))}
        </MapContainer>
      </div>

      {/* ── Re-center button ────────────────────────────────────────────── */}
      {!autoCenter && (
        <button
          onClick={() => { setAutoCenter(true); }}
          className={styles.tacticalRecenterBtn}
          style={{ zIndex: 6000 }}
        >
          🎯 RECENTRER
        </button>
      )}

      <style>{`
        .custom-zone-tooltip { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: white; font-size: 10px; font-weight: 500; padding: 2px 6px; backdrop-filter: blur(4px); }
        .leaflet-routing-container { display: none !important; }
        @keyframes siren-flash { from { opacity: 0.2; } to { opacity: 1; filter: brightness(1.5); } }
        @keyframes alert-pulse { 0% { scale: 1; } 50% { scale: 1.1; opacity: 0.8; } 100% { scale: 1; } }
      `}</style>
    </div>
  );
}

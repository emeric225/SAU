'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, GeoJSON, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

// Fix for default Leaflet icons in Next.js
if (typeof window !== 'undefined') {
  const DefaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
  L.Marker.prototype.options.icon = DefaultIcon;
}

// --- Icons ---
const VehicleIcon = (rotation: number) => L.divIcon({
  className: 'custom-vehicle-icon',
  html: `<div style="transform: rotate(${rotation}deg); transition: transform 0.25s ease; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
      <svg width="40" height="40" viewBox="0 0 24 24" style="filter: drop-shadow(0 0 8px rgba(225,29,72,0.9));">
        <path d="M12 2L2 22L12 18L22 22L12 2Z" fill="url(#grad1)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#e11d48;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#be123c;stop-opacity:1" />
          </linearGradient>
        </defs>
      </svg>
      <div style="position: absolute; top: 12px; font-size: 14px;">🚒</div>
      <div style="position: absolute; top: -2px; left: 10px; width: 6px; height: 6px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 10px #3b82f6; animation: siren-flash 0.4s infinite alternate;"></div>
      <div style="position: absolute; top: -2px; right: 10px; width: 6px; height: 6px; background: #e11d48; border-radius: 50%; box-shadow: 0 0 10px #e11d48; animation: siren-flash 0.4s 0.2s infinite alternate;"></div>
    </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

const StationIcon = (status: string) => {
  let color = '#3b82f6'; // blue (available)
  if (status === 'busy') color = '#f59e0b'; // orange (busy)
  if (status === 'offline' || status === 'unactive') color = '#64748b'; // slate (offline)
  
  return L.divIcon({
    className: 'custom-station-icon',
    html: `<div style="background: ${color}; width: 32px; height: 32px; border-radius: 10px; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${color}66;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const UnitMapIcon = (type: string, status: string) => {
  let color = '#10b981'; // green (available)
  if (status === 'en_route') color = '#f59e0b'; // orange
  if (status === 'on_site') color = '#ef4444'; // red
  const emoji = type === 'ambulance' ? '🚑' : 
                type === 'moto' ? '🏍️' : 
                type === 'command' ? '🚙' :
                type === 'tanker' ? '🚚' : '🚒';
  return L.divIcon({
    className: 'custom-unit-icon',
    html: `<div style="background: ${color}; width: 36px; height: 36px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${color}66; font-size: 20px;">
            ${emoji}
          </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

const AlertIcon = (status: string, type: string) => L.divIcon({
  className: 'custom-alert-icon',
  html: `<div style="background: ${status === 'pending' ? '#e11d48' : '#fbbf24'}; width: 40px; height: 40px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px ${status === 'pending' ? 'rgba(225,29,72,0.6)' : 'rgba(251,191,36,0.6)'}; ${status === 'pending' ? 'animation: alert-pulse 1.2s infinite;' : ''}">
          <span style="font-size: 20px;">${type === 'fire' ? '🔥' : type === 'medical' ? '🚑' : '🚗'}</span>
        </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// --- Lerp helpers ---
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function calcBearing(p1: [number, number], p2: [number, number]): number {
  const dLon = (p2[1] - p1[1]) * (Math.PI / 180);
  const lat1 = p1[0] * (Math.PI / 180);
  const lat2 = p2[0] * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x) * (180 / Math.PI);
}

// Haversine distance in meters between two [lat, lng] points
function distanceMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Smooth angle interpolation (shortest arc)
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * t;
}

// --- MapRotator: Rotates the tile pane (heading-up) without breaking Leaflet ---
function MapRotator({ bearing, active }: { bearing: number; active: boolean }) {
  const map = useMap();

  useEffect(() => {
    const tilePane = map.getPanes().tilePane as HTMLElement;
    const overlayPane = map.getPanes().overlayPane as HTMLElement;
    const shadowPane = map.getPanes().shadowPane as HTMLElement;
    const markerPane = map.getPanes().markerPane as HTMLElement;

    if (!tilePane) return;

    if (active) {
      // Rotate only background tiles — markers stay upright
      const rot = `rotate(${-bearing}deg) scale(1.55)`;
      tilePane.style.transform = rot;
      tilePane.style.transformOrigin = 'center center';
      tilePane.style.transition = 'transform 0.4s linear';
      // Keep overlay (polylines) rotating with tiles for correct heading
      overlayPane.style.transform = rot;
      overlayPane.style.transformOrigin = 'center center';
      overlayPane.style.transition = 'transform 0.4s linear';
      // Shadow pane too
      shadowPane.style.transform = rot;
      shadowPane.style.transformOrigin = 'center center';
      // Counter-rotate markers so they stay upright
      markerPane.style.transform = `rotate(${bearing}deg) scale(${1/1.55})`;
      markerPane.style.transformOrigin = 'center center';
      markerPane.style.transition = 'transform 0.4s linear';
    } else {
      // Reset all transforms
      [tilePane, overlayPane, shadowPane, markerPane].forEach(p => {
        p.style.transform = '';
        p.style.transition = '';
      });
    }
  }, [bearing, active, map]);

  return null;
}

// --- MapRecenter: locks map onto position in navigation mode ---
function MapRecenter({ center, navigationActive, autoCenter, setAutoCenter }: { center: [number, number]; navigationActive: boolean; autoCenter: boolean; setAutoCenter: (v: boolean) => void }) {
  const map = useMapEvents({
    dragstart: () => {
      // Si l'utilisateur touche la carte, on stoppe le suivi automatique
      if (navigationActive) {
        setAutoCenter(false);
      }
    }
  });

  useEffect(() => {
    if (navigationActive && autoCenter) {
      map.setView(center, 19, { animate: true, duration: 0.5 });
    } else if (!navigationActive && autoCenter) {
      map.setView(center, 14, { animate: true, duration: 0.8 });
    }
  }, [center, map, navigationActive, autoCenter]);
  return null;
}

// --- MovingUnit: Smoothly animates unit between GPS points ---
function MovingUnit({ id, type, status, name, lat, lng }: { id: string; type: string; status: string; name: string; lat: number; lng: number }) {
  const [pos, setPos] = useState<[number, number]>([lat, lng]);
  const lastPosRef = useRef<[number, number]>([lat, lng]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const startPos = lastPosRef.current;
    const targetPos: [number, number] = [lat, lng];
    
    if (startPos[0] === targetPos[0] && startPos[1] === targetPos[1]) return;

    let startTime: number | null = null;
    const DURATION = 1800; // Interpolate over 1.8s for smooth 2s updates

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const elapsed = time - startTime;
      const t = Math.min(elapsed / DURATION, 1);

      const currentLat = lerp(startPos[0], targetPos[0], t);
      const currentLng = lerp(startPos[1], targetPos[1], t);
      
      setPos([currentLat, currentLng]);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        lastPosRef.current = targetPos;
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [lat, lng]);

  return (
    <Marker position={pos} icon={UnitMapIcon(type, status)}>
      <Popup>
        <strong>{name}</strong><br />
        Statut: {status.toUpperCase()}
      </Popup>
    </Marker>
  );
}

// --- Props ---
interface MapProps {
  stations: any[];
  alerts: any[];
  center?: [number, number];
  selectedAlert?: any;
  navigationActive?: boolean;
  onRouteDataReady?: (data: { distanceKm: number; durationMin: number; segmentCount: number }) => void;
  onVehicleProgress?: (segmentIndex: number) => void;
  units?: any[];
  isLiveUnitMode?: boolean;
  selfUnitId?: string;
}

// Speed for simulation: avg ~40 km/h = ~11.1 m/s → each segment ~80ms
const SEGMENT_DURATION_MS = 80;

export default function Map({
  stations,
  alerts,
  center = [5.3365, -4.0268],
  selectedAlert,
  navigationActive = false,
  onRouteDataReady,
  onVehicleProgress,
  units = [],
  isLiveUnitMode = false,
  selfUnitId
}: MapProps) {
  const [route, setRoute] = useState<[number, number][]>([]);
  const [vehiclePos, setVehiclePos] = useState<[number, number] | null>(null);
  const [rotation, setRotation] = useState(0);
  const [smoothRotation, setSmoothRotation] = useState(0);
  const [autoCenter, setAutoCenter] = useState(true);
  const prevNavigationActive = useRef(false);
  const smoothRotRef = useRef(0);

  // rAF state
  const rafRef = useRef<number | null>(null);
  const segmentRef = useRef(0);
  const segmentStartTimeRef = useRef<number | null>(null);
  const routeRef = useRef<[number, number][]>([]);

  // Keep routeRef in sync
  useEffect(() => { routeRef.current = route; }, [route]);

  // Fetch route from OSRM
  const getRoute = useCallback(async (startLnLat: [number, number]) => {
    if (!selectedAlert || isNaN(startLnLat[0]) || isNaN(startLnLat[1])) return;
    const alertLat = selectedAlert.location?.lat ?? selectedAlert.lat;
    const alertLng = selectedAlert.location?.lng ?? selectedAlert.lng;
    if (!alertLat || !alertLng) return;
    const url = `https://router.project-osrm.org/route/v1/driving/${startLnLat[0]},${startLnLat[1]};${alertLng},${alertLat}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes[0]) {
        const coords: [number, number][] = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        const distanceKm = data.routes[0].distance / 1000;
        const durationMin = data.routes[0].duration / 60;
        setRoute(coords);
        if (!isLiveUnitMode) {
           segmentRef.current = 0;
           setVehiclePos(coords[0]);
        }
        onRouteDataReady?.({ distanceKm, durationMin, segmentCount: coords.length });
      }
    } catch (err) { }
  }, [selectedAlert, isLiveUnitMode, onRouteDataReady]);

  // Handle route fetching behaviors (Simulated vs Live)
  useEffect(() => {
    if (!selectedAlert) {
      stopAnimation();
      setRoute([]);
      setVehiclePos(null);
      return;
    }

    if (!isLiveUnitMode) {
      // STATIC / SIMULATED ROUTING
      const station = stations?.find((s: any) => s.id === selectedAlert.station_id);
      const start: [number, number] = station
        ? [Number(station.lng), Number(station.lat)]
        : [center[1], center[0]];
      getRoute(start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlert?.id, selectedAlert?.status, isLiveUnitMode]);

  // LIVE GPS POLLING AND RECALCULATION
  const liveCoordsRef = useRef<[number, number]>([center[1], center[0]]);
  useEffect(() => {
    // OSRM wants [lng, lat]
    liveCoordsRef.current = [center[1], center[0]];
  }, [center]);

  // Find nearest route segment to current GPS position
  const findNearestSegment = useCallback((pos: [number, number], r: [number, number][]): number => {
    if (r.length < 2) return 0;
    let minDist = Infinity;
    let nearest = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const d = distanceMeters(pos, r[i]);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    return nearest;
  }, []);

  useEffect(() => {
    if (isLiveUnitMode && navigationActive && selectedAlert) {
      // Reset autoCenter when navigation starts
      if (!prevNavigationActive.current) {
        setAutoCenter(true);
        prevNavigationActive.current = true;
      }
      // Initial fetch
      getRoute(liveCoordsRef.current);
      // Recalculate every 15s based on real position
      const interval = setInterval(() => {
        getRoute(liveCoordsRef.current);
      }, 15000);
      return () => clearInterval(interval);
    } else {
      prevNavigationActive.current = false;
    }
  }, [isLiveUnitMode, navigationActive, selectedAlert, getRoute]);

  // --- rAF animation loop ---
  const stopAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    segmentStartTimeRef.current = null;
  }, []);

  const animate = useCallback((timestamp: number) => {
    const r = routeRef.current;
    const seg = segmentRef.current;

    if (!r || seg >= r.length - 1) {
      stopAnimation();
      return;
    }

    if (segmentStartTimeRef.current === null) {
      segmentStartTimeRef.current = timestamp;
    }

    const elapsed = timestamp - segmentStartTimeRef.current;
    const t = Math.min(elapsed / SEGMENT_DURATION_MS, 1);

    const p1 = r[seg];
    const p2 = r[seg + 1];

    // Interpolated position
    const lat = lerp(p1[0], p2[0], t);
    const lng = lerp(p1[1], p2[1], t);
    setVehiclePos([lat, lng]);

    // Heading
    const bear = calcBearing(p1, p2);
    setRotation(bear);

    if (t >= 1) {
      // Advance to next segment
      segmentRef.current = seg + 1;
      segmentStartTimeRef.current = null;
      onVehicleProgress?.(seg + 1);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [stopAnimation, onVehicleProgress]);

  // Start / stop animation based on navigationActive
  useEffect(() => {
    if (!isLiveUnitMode) {
      if (navigationActive && route.length > 1) {
        stopAnimation();
        segmentRef.current = 0;
        segmentStartTimeRef.current = null;
        rafRef.current = requestAnimationFrame(animate);
      } else {
        stopAnimation();
      }
    }
    return stopAnimation;
  }, [navigationActive, route, animate, stopAnimation, isLiveUnitMode]);

  // LIVE MODE: smooth interpolation + bearing + route progress
  const lastCenterRef = useRef<[number, number]>(center);
  const liveInterpRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (isLiveUnitMode && navigationActive) {
      const p1 = lastCenterRef.current;
      const p2 = center;

      // Skip strictly identical positions
      if (p1[0] === p2[0] && p1[1] === p2[1]) return;

      const dist = distanceMeters(p1, p2);

      // Update bearing only on significant movement (>5m) to avoid GPS jitter
      if (dist > 5) {
        const bear = calcBearing(p1, p2);
        setRotation(bear);
        lastCenterRef.current = p2;
      }

      // Update route progress: find nearest route segment to current GPS position
      const currentRoute = routeRef.current;
      if (currentRoute && currentRoute.length > 1) {
        const nearest = findNearestSegment(p2, currentRoute);
        if (nearest > segmentRef.current) {
          segmentRef.current = nearest;
          onVehicleProgress?.(nearest);
        }
      }

      // Smooth position interpolation
      let startT: number | null = null;
      const DURATION = 2000;
      const interp = (t: number) => {
        if (!startT) startT = t;
        const elapsed = t - startT;
        const progress = Math.min(elapsed / DURATION, 1);
        setVehiclePos([lerp(p1[0], p2[0], progress), lerp(p1[1], p2[1], progress)]);
        if (progress < 1) {
          liveInterpRef.current = requestAnimationFrame(interp);
        } else {
          lastCenterRef.current = p2;
        }
      };
      if (liveInterpRef.current) cancelAnimationFrame(liveInterpRef.current);
      liveInterpRef.current = requestAnimationFrame(interp);

      return () => {
        if (liveInterpRef.current) cancelAnimationFrame(liveInterpRef.current);
      };
    } else if (isLiveUnitMode && !navigationActive) {
      // Idle — just place vehicle at GPS, no rotation
      setVehiclePos(center);
      setRotation(0);
      lastCenterRef.current = center;
      segmentRef.current = 0;
    }
  }, [center, isLiveUnitMode, navigationActive, findNearestSegment, onVehicleProgress]);

  // Smooth rotation with exponential filter to avoid sudden arrow jumps
  useEffect(() => {
    const targetRot = rotation;
    let rafId: number;
    const step = () => {
      const current = smoothRotRef.current;
      const next = lerpAngle(current, targetRot, 0.12); // 12% per frame = smooth
      const diff = Math.abs(next - current);
      smoothRotRef.current = next;
      setSmoothRotation(next);
      if (diff > 0.05) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [rotation]);

  const mapCenter: [number, number] = isLiveUnitMode
    ? (vehiclePos || center)
    : (navigationActive && vehiclePos)
      ? vehiclePos
      : selectedAlert
        ? [
            selectedAlert.location?.lat ?? selectedAlert.lat ?? center[0],
            selectedAlert.location?.lng ?? selectedAlert.lng ?? center[1]
          ]
        : center;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#0a0a0a' }}>
        <MapContainer center={center} zoom={13} maxZoom={22} style={{ height: '100%', width: '100%', zIndex: 0 }} zoomControl={false}>
        <MapRotator bearing={smoothRotation} active={isLiveUnitMode && navigationActive} />
        <MapRecenter center={mapCenter} navigationActive={navigationActive} autoCenter={autoCenter} setAutoCenter={setAutoCenter} />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; CARTO'
          maxNativeZoom={19}
          maxZoom={22}
        />


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

       {stations.filter((s: any) => s && !isNaN(Number(s.lat)) && !isNaN(Number(s.lng))).map((s: any) => (
         <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={StationIcon(s.status || 'available')}>
           <Popup>
              <strong>{s.name}</strong><br />
              Statut: {s.status === 'busy' ? 'En intervention (Engagée)' : s.status === 'offline' ? 'Hors service' : 'Disponible'}
           </Popup>
         </Marker>
       ))}
        {units
          .filter((u: any) => u && !isNaN(Number(u.lat)) && !isNaN(Number(u.lng)))
          .filter((u: any) => u.id !== selfUnitId) // Eviter le dédoublement de l'unité elle-même
          .map((u: any) => (
          <MovingUnit             key={u.id}
            id={u.id}
            type={u.type}
            status={u.status}
            name={u.name}
            lat={Number(u.lat)}
            lng={Number(u.lng)}
          />
        ))}

      {alerts.filter(a => {
        const lat = a.location?.lat ?? a.lat;
        const lng = a.location?.lng ?? a.lng;
        return lat && lng && !isNaN(Number(lat)) && !isNaN(Number(lng));
      }).map((a) => {
        const lat = Number(a.location?.lat ?? a.lat);
        const lng = Number(a.location?.lng ?? a.lng);
        return (
          <Marker key={a.id} position={[lat, lng]} icon={AlertIcon(a.status, a.type)}>
            <Popup><strong>URGENCE {a.type.toUpperCase()}</strong><br />Statut: {a.status}</Popup>
          </Marker>
        );
      })}

      {route.length > 0 && (
        <>
          {/* Route traversée (bleu vif) */}
          <Polyline
            positions={route.slice(0, segmentRef.current + 1)}
            color="#60a5fa"
            weight={5}
            opacity={0.9}
          />
          {/* Route restante (gris translucide) */}
          <Polyline
            positions={route.slice(segmentRef.current)}
            color="#3b82f6"
            weight={7}
            opacity={0.25}
            dashArray="1, 12"
            lineCap="round"
          />
        </>
      )}

      {vehiclePos && (
        <Marker position={vehiclePos} icon={VehicleIcon(smoothRotation)} />
      )}

      </MapContainer>

      {/* RECENTER BUTTON OVERLAY */}
      {navigationActive && !autoCenter && (
        <button 
          onClick={() => setAutoCenter(true)}
          className={styles.tacticalRecenterBtn}
        >
          <span>🎯</span> RECENTRER
        </button>
      )}

      <style>{`
        @keyframes alert-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.8; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes siren-flash {
          from { opacity: 0.3; }
          to { opacity: 1; box-shadow: 0 0 16px currentColor; }
        }
        .custom-zone-tooltip {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 4px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          color: white;
          font-weight: 500;
          font-size: 12px;
          padding: 4px 8px;
          backdrop-filter: blur(4px);
        }
        .leaflet-tooltip-top:before,
        .leaflet-tooltip-bottom:before,
        .leaflet-tooltip-left:before,
        .leaflet-tooltip-right:before {
          border: none !important;
        }
      `}</style>
    </div>
  );
}

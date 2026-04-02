'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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
  html: `<div style="transform: rotate(${rotation}deg); transition: transform 0.25s ease; width: 48px; height: 26px; background: linear-gradient(135deg, #e11d48, #be123c); border: 2.5px solid white; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 24px rgba(225,29,72,0.9), 0 0 8px rgba(0,0,0,0.5);">
      <span style="font-size:16px; line-height:1;">🚒</span>
      <div style="position: absolute; top: -7px; left: 6px; width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 12px #3b82f6; animation: siren-flash 0.4s infinite alternate;"></div>
      <div style="position: absolute; top: -7px; right: 6px; width: 8px; height: 8px; background: #e11d48; border-radius: 50%; box-shadow: 0 0 12px #e11d48; animation: siren-flash 0.4s 0.2s infinite alternate;"></div>
    </div>`,
  iconSize: [48, 26],
  iconAnchor: [24, 13],
});

const StationIcon = (status: string) => L.divIcon({
  className: 'custom-station-icon',
  html: `<div style="background: ${status === 'active' ? '#3b82f6' : '#64748b'}; width: 32px; height: 32px; border-radius: 10px; border: 2px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
        </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

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

// --- MapRecenter: locks map onto position in navigation mode ---
function MapRecenter({ center, navigationActive }: { center: [number, number]; navigationActive: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (navigationActive) {
      map.setView(center, 17, { animate: true, duration: 0.5 });
    } else {
      map.setView(center, 14, { animate: true, duration: 0.8 });
    }
  }, [center, map, navigationActive]);
  return null;
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
}: MapProps) {
  const [route, setRoute] = useState<[number, number][]>([]);
  const [vehiclePos, setVehiclePos] = useState<[number, number] | null>(null);
  const [rotation, setRotation] = useState(0);

  // rAF state
  const rafRef = useRef<number | null>(null);
  const segmentRef = useRef(0);
  const segmentStartTimeRef = useRef<number | null>(null);
  const routeRef = useRef<[number, number][]>([]);

  // Keep routeRef in sync
  useEffect(() => { routeRef.current = route; }, [route]);

  // Fetch route from OSRM
  useEffect(() => {
    const getRoute = async () => {
      if (
        selectedAlert &&
        (selectedAlert.status === 'dispatched' || (selectedAlert.status === 'pending' && selectedAlert.station_id))
      ) {
        const station = stations.find((s: any) => s.id === selectedAlert.station_id);
        const start = station
          ? [Number(station.lng), Number(station.lat)]
          : [selectedAlert.location.lng - 0.005, selectedAlert.location.lat + 0.005];

        if (isNaN(start[0]) || isNaN(start[1])) return;

        const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${selectedAlert.location.lng},${selectedAlert.location.lat}?overview=full&geometries=geojson`;
        try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.routes && data.routes[0]) {
            const coords: [number, number][] = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
            const distanceKm = data.routes[0].distance / 1000;
            const durationMin = data.routes[0].duration / 60;
            setRoute(coords);
            segmentRef.current = 0;
            setVehiclePos(coords[0]);
            onRouteDataReady?.({ distanceKm, durationMin, segmentCount: coords.length });
          }
        } catch {
          // Fallback straight line
          const fallback: [number, number][] = [
            [Number(start[1]), Number(start[0])],
            [selectedAlert.location.lat, selectedAlert.location.lng],
          ];
          setRoute(fallback);
          segmentRef.current = 0;
          setVehiclePos(fallback[0]);
          onRouteDataReady?.({ distanceKm: 2, durationMin: 5, segmentCount: 2 });
        }
      } else {
        // Stop everything
        stopAnimation();
        setRoute([]);
        setVehiclePos(null);
      }
    };
    getRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlert?.id, selectedAlert?.status]);

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
    if (navigationActive && route.length > 1) {
      stopAnimation();
      segmentRef.current = 0;
      segmentStartTimeRef.current = null;
      rafRef.current = requestAnimationFrame(animate);
    } else {
      stopAnimation();
    }
    return stopAnimation;
  }, [navigationActive, route, animate, stopAnimation]);

  const mapCenter: [number, number] = vehiclePos && navigationActive
    ? vehiclePos
    : selectedAlert
      ? [selectedAlert.location.lat, selectedAlert.location.lng]
      : center;

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; CARTO'
      />

      {(selectedAlert || (vehiclePos && navigationActive)) && (
        <MapRecenter center={mapCenter} navigationActive={navigationActive} />
      )}

      {stations.map((s: any) => (
        <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={StationIcon(s.status || 'active')}>
          <Popup><strong>{s.name}</strong><br />{s.status === 'active' ? 'Opérationnel' : 'Hors service'}</Popup>
        </Marker>
      ))}

      {alerts.map((a) => (
        <Marker key={a.id} position={[a.location.lat, a.location.lng]} icon={AlertIcon(a.status, a.type)}>
          <Popup><strong>URGENCE {a.type.toUpperCase()}</strong><br />Statut: {a.status}</Popup>
        </Marker>
      ))}

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
        <Marker position={vehiclePos} icon={VehicleIcon(rotation)} />
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
      `}</style>
    </MapContainer>
  );
}

'use client';
import { useState, useCallback, useRef } from 'react';

interface OSRMResult {
  geometry: any;       // GeoJSON LineString for the map layer
  steps: any[];        // Navigation steps
  distanceM: number;
  durationS: number;
}

export function useOSRM() {
  const [route, setRoute] = useState<OSRMResult | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchRoute = useCallback(async (
    fromPos: [number, number],   // [lat, lng]
    toLat: number,
    toLng: number,
  ) => {
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Coordinates guard
    if (Math.abs(fromPos[0]) < 0.01 && Math.abs(fromPos[1]) < 0.01) {
      console.warn('[OSRM] Invalid origin position');
      return;
    }
    if (!toLat || !toLng || isNaN(toLat) || isNaN(toLng)) {
      console.error('[OSRM] Invalid destination:', toLat, toLng);
      return;
    }

    // OSRM format: lng,lat;lng,lat
    const url = `https://router.project-osrm.org/route/v1/driving/${fromPos[1]},${fromPos[0]};${toLng},${toLat}?overview=full&geometries=geojson&steps=true&language=fr`;

    setLoading(true);
    console.log('[OSRM] 🗺️ Fetching:', url.substring(0, 120));

    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const r = data.routes?.[0];
        if (!r) throw new Error('No route returned');

        setRoute({
          geometry: r.geometry,
          steps: r.legs[0]?.steps || [],
          distanceM: r.distance,
          durationS: r.duration,
        });
        setLoading(false);
        console.log(`[OSRM] ✅ Route OK — ${(r.distance / 1000).toFixed(1)} km`);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') { setLoading(false); return; }
        console.warn(`[OSRM] ⚠️ Attempt ${attempt + 1} failed:`, err.message);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    setLoading(false);
    console.error('[OSRM] ❌ All attempts failed');
  }, []);

  const clearRoute = useCallback(() => {
    abortRef.current?.abort();
    setRoute(null);
    setLoading(false);
  }, []);

  return { route, loading, fetchRoute, clearRoute };
}

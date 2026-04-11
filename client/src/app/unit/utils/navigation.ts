export function processNavigation(lngLat: [number, number], geojson: any) {
  if (!geojson || geojson.type !== 'LineString' || !geojson.coordinates || geojson.coordinates.length < 2) {
    return { snapped: lngLat, distanceMeters: 0, trimmedGeoJSON: geojson, segmentIndex: 0 };
  }
  
  const [px, py] = lngLat;
  // Local Equirectangular projection scale
  const cosLat = Math.cos(py * Math.PI / 180);
  
  const localX = (lng: number) => (lng - px) * cosLat;
  const localY = (lat: number) => (lat - py);

  let minDist = Infinity;
  let snappedLocal: [number, number] = [0, 0];
  let bestSegment = 0;

  for (let i = 0; i < geojson.coordinates.length - 1; i++) {
    const ax = localX(geojson.coordinates[i][0]);
    const ay = localY(geojson.coordinates[i][1]);
    const bx = localX(geojson.coordinates[i + 1][0]);
    const by = localY(geojson.coordinates[i + 1][1]);
    
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) continue;
    
    // P is at [0,0] in local space
    const t = (0 - ax) * dx + (0 - ay) * dy;
    const lenSq = dx * dx + dy * dy;
    const clampedT = Math.max(0, Math.min(1, t / lenSq));
    
    const projX = ax + clampedT * dx;
    const projY = ay + clampedT * dy;
    
    const distSq = projX * projX + projY * projY;
    if (distSq < minDist) {
      minDist = distSq;
      snappedLocal = [projX, projY];
      bestSegment = i;
    }
  }

  // Un-project back to WGS84
  const snappedLng = px + snappedLocal[0] / cosLat;
  const snappedLat = py + snappedLocal[1];
  const snapped: [number, number] = [snappedLng, snappedLat];

  // Dynamic trimming: Remove path behind the vehicle
  const trimmedCoords = [snapped];
  for (let i = bestSegment + 1; i < geojson.coordinates.length; i++) {
    trimmedCoords.push(geojson.coordinates[i]);
  }

  // 1 degree ~ 111,139 meters at the equator/meridian.
  const distanceMeters = Math.sqrt(minDist) * 111139;

  return {
    snapped,
    distanceMeters,
    trimmedGeoJSON: {
      type: 'LineString',
      coordinates: trimmedCoords
    },
    segmentIndex: bestSegment
  };
}

export function getLineStringLengthMeters(geojson: any): number {
  if (!geojson || !geojson.coordinates || geojson.coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < geojson.coordinates.length - 1; i++) {
    const [x1, y1] = geojson.coordinates[i];
    const [x2, y2] = geojson.coordinates[i+1];
    total += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) * 111000;
  }
  return total;
}

export function getCurrentInstruction(steps: any[], traversedDistanceM: number) {
  if (!steps || steps.length === 0) return { instruction: '', stepRemaining: 0 };
  
  let accumulatedDist = 0;
  for (let i = 0; i < steps.length; i++) {
    accumulatedDist += steps[i].distance;
    if (accumulatedDist > traversedDistanceM) {
      // The vehicle is currently inside this step!
      // The distance left to complete THIS maneuver is the end of the step minus what we already traversed.
      const stepRemaining = accumulatedDist - traversedDistanceM;
      // Some maneuvers don't have instructions, so we provide fallback
      let text = steps[i].maneuver?.instruction || steps[i].name || 'Poursuivre la route';
      if (!steps[i].maneuver?.instruction && steps[i].name) {
         text = 'Continuer sur ' + steps[i].name;
      }
      return { instruction: text, stepRemaining };
    }
  }
  
  // Arrived?
  return { instruction: 'Vous arrivez à destination', stepRemaining: 0 };
}

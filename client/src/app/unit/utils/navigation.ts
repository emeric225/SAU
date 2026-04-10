export function processNavigation(lngLat: [number, number], geojson: any) {
  if (!geojson || geojson.type !== 'LineString' || !geojson.coordinates || geojson.coordinates.length < 2) {
    return { snapped: lngLat, distanceMeters: 0, trimmedGeoJSON: geojson, segmentIndex: 0 };
  }
  
  const [px, py] = lngLat;
  let minDist = Infinity;
  let snapped: [number, number] = lngLat;
  let bestSegment = 0;

  for (let i = 0; i < geojson.coordinates.length - 1; i++) {
    const [ax, ay] = geojson.coordinates[i];
    const [bx, by] = geojson.coordinates[i + 1];
    
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) continue;
    
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    const clampedT = Math.max(0, Math.min(1, t));
    const projX = ax + clampedT * dx;
    const projY = ay + clampedT * dy;
    
    const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
    if (distSq < minDist) {
      minDist = distSq;
      snapped = [projX, projY];
      bestSegment = i;
    }
  }

  // Dynamic trimming: Remove path behind the vehicle
  const trimmedCoords = [snapped];
  for (let i = bestSegment + 1; i < geojson.coordinates.length; i++) {
    trimmedCoords.push(geojson.coordinates[i]);
  }

  // Approx conversion from degrees to meters (very rough, but sufficient for 30m threshold).
  // Euclidean distance approximation.
  const distanceMeters = Math.sqrt(minDist) * 111000;

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

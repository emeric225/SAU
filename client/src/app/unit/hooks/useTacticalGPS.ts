import { useState, useEffect, useRef } from 'react';

// Mathématiques spatiales pour calculer le cap si le GPS ne le fournit pas
function toRad(d: number) { return d * Math.PI / 180; }
function toDeg(r: number) { return r * 180 / Math.PI; }

function bearing(startMap: [number, number], endMap: [number, number]): number {
  const lat1 = toRad(startMap[0]), lat2 = toRad(endMap[0]), dLon = toRad(endMap[1] - startMap[1]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function useTacticalGPS() {
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(0);
  
  const lastPosRef = useRef<[number, number] | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, speed: gpsSpeed, heading: gpsHeading } = pos.coords;
        const currentPos: [number, number] = [latitude, longitude];
        
        let calculatedHeading = gpsHeading ?? 0;
        
        // Si le heading natif est indisponible mais qu'on a bougé, on calcule le vecteur
        if (gpsHeading === null && lastPosRef.current && (gpsSpeed === null || gpsSpeed > 0.5)) {
          const d = Math.sqrt(Math.pow(latitude - lastPosRef.current[0], 2) + Math.pow(longitude - lastPosRef.current[1], 2));
          if (d > 0.00005) { // Seuil min (env 5-10m) pour éviter que le GPS drift ne fausse le cap
            calculatedHeading = bearing(lastPosRef.current, currentPos);
          } else {
             // on garde l'ancien heading si on n'a presque pas bougé
            setHeading((prev) => prev);
            return; 
          }
        }

        // On ne met à jour l'état que si ça a bougé pour éviter le re-render en rafale (drift static)
        if (!lastPosRef.current || Math.abs(lastPosRef.current[0] - latitude) > 0.00001 || Math.abs(lastPosRef.current[1] - longitude) > 0.00001) {
          setPosition(currentPos);
          setHeading(calculatedHeading);
          setSpeed(gpsSpeed ?? 0);
          lastPosRef.current = currentPos;
        }
      },
      (err) => console.warn('[GPS] Watch error:', err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );

    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  return { position, heading, speed };
}

import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';

export function useTacticalSync(
  unitId: string | undefined, 
  status: string, 
  position: [number, number] | null, 
  heading: number, 
  speed: number, 
  socket: Socket | null
) {
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!unitId || !position || !socket) return;

    // Pulse DB every 3 seconds
    syncIntervalRef.current = setInterval(async () => {
      try {
        // Envoi au socket pour la MAJ temps reel (Dashboard dispatch)
        socket.emit('unit_moved', {
          id: unitId,
          lat: position[0],
          lng: position[1],
          heading,
          speed,
        });

      } catch (err) {
        // Si ça fail, on pourrait bufferiser dans le localStorage, mais pour le smooth tracking le real-time (socket) suffit car la Map Dashboard écoute ça.
        // La persistance backend complète est traitée par le webhook ou un patch.
        console.warn('[Sync] Un reachable:', err);
      }
    }, 3000);

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [unitId, status, position, heading, speed, socket]);

}

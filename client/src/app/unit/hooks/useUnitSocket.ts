'use client';
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseUnitSocketOptions {
  unitId: string | null;
  onMissionReceived: (mission: any) => void;
  onUnitUpdated: (unit: any) => void;
  onConnectChange: (connected: boolean) => void;
}

export function useUnitSocket({
  unitId,
  onMissionReceived,
  onUnitUpdated,
  onConnectChange,
}: UseUnitSocketOptions) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!unitId) return;

    const socket = io(process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008', {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_room', unitId);
      onConnectChange(true);
      console.log('[Socket] ✅ Connected, joined room:', unitId);
    });
    socket.on('disconnect', () => onConnectChange(false));
    socket.on('mission_received', onMissionReceived);
    socket.on('unit_updated', (u: any) => {
      if (u.id === unitId) onUnitUpdated(u);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [unitId]);

  /** Emit a status update to the server */
  const emitStatus = useCallback((status: string, alertId?: string) => {
    socketRef.current?.emit('unit_status_update', { unitId, status, alertId });
  }, [unitId]);

  /** Emit real-time GPS position */
  const emitPosition = useCallback((lat: number, lng: number, heading: number, speed: number) => {
    socketRef.current?.emit('unit_moved', { id: unitId, lat, lng, heading, speed });
  }, [unitId]);

  const isConnected = () => socketRef.current?.connected ?? false;

  return { emitStatus, emitPosition, isConnected };
}

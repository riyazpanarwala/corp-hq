// src/hooks/useSocket.js
"use client";
import { useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

export function useSocket(accessToken) {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!accessToken) return;

    const socket = io(process.env.NEXT_PUBLIC_APP_URL || "", {
      path:        "/api/socket",
      auth:        { token: `Bearer ${accessToken}` },
      transports:  ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    socket.on("connect",       () => console.log("[Socket] connected:", socket.id));
    socket.on("disconnect",    r  => console.log("[Socket] disconnected:", r));
    socket.on("connect_error", e  => console.warn("[Socket] error:", e.message));

    socketRef.current = socket;
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [accessToken]);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  const off = useCallback((event, handler) => {
    socketRef.current?.off(event, handler);
  }, []);

  return { socket: socketRef.current, on, off };
}

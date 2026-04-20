// src/hooks/useSocket.js
"use client";
import { useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";

export function useSocket(accessToken) {
  const socketRef    = useRef(null);

  // MAJOR FIX: Track active subscriptions so they can be re-applied after reconnect.
  // Previously, `on()` captured socketRef.current at call time. After a disconnect
  // and reconnect socketRef.current pointed to a new socket instance, but all
  // existing listeners were still bound to the old dead socket.
  const handlersRef  = useRef(new Map()); // event → Set<handler>

  useEffect(() => {
    if (!accessToken) return;

    const socket = io(process.env.NEXT_PUBLIC_APP_URL || "", {
      path:                 "/api/socket",
      auth:                 { token: `Bearer ${accessToken}` },
      transports:           ["websocket", "polling"],
      reconnection:         true,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      console.log("[Socket] connected:", socket.id);
      // Re-apply all active subscriptions on every (re)connect
      handlersRef.current.forEach((handlers, event) => {
        handlers.forEach(handler => socket.on(event, handler));
      });
    });

    socket.on("disconnect",    (r) => console.log("[Socket] disconnected:", r));
    socket.on("connect_error", (e) => console.warn("[Socket] error:", e.message));

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken]);

  const on = useCallback((event, handler) => {
    // Register in the persistent map so reconnects re-apply it
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event).add(handler);

    // Also subscribe on the current socket if it exists and is connected
    socketRef.current?.on(event, handler);

    // Return an unsubscribe function
    return () => {
      handlersRef.current.get(event)?.delete(handler);
      socketRef.current?.off(event, handler);
    };
  }, []);

  const off = useCallback((event, handler) => {
    handlersRef.current.get(event)?.delete(handler);
    socketRef.current?.off(event, handler);
  }, []);

  return { socket: socketRef.current, on, off };
}

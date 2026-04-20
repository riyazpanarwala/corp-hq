// src/components/providers/AuthProvider.js
"use client";
import { createContext, useContext } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSocket } from "@/hooks/useSocket";

const AuthContext = createContext(null);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const auth = useAuth();
  const socket = useSocket(auth.accessToken);

  return (
    <AuthContext.Provider
      value={{ ...auth, socketOn: socket.on, socketOff: socket.off }}
    >
      {children}
    </AuthContext.Provider>
  );
}

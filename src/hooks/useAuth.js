// src/hooks/useAuth.js
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const TOKEN_KEY = "corp_hq_access";
const USER_KEY  = "corp_hq_user";

function saveSession(access, user) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(USER_KEY,  JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function getStored() {
  if (typeof window === "undefined") return { access: null, user: null };
  try {
    return {
      access: localStorage.getItem(TOKEN_KEY),
      user:   JSON.parse(localStorage.getItem(USER_KEY) || "null"),
    };
  } catch {
    return { access: null, user: null };
  }
}

function tokenExpiry(token) {
  try {
    return JSON.parse(atob(token.split(".")[1])).exp * 1000;
  } catch {
    return null;
  }
}

export function useAuth() {
  const router   = useRouter();
  const timerRef = useRef(null);

  const [user,        setUser]        = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading,   setIsLoading]   = useState(false);
  const [isHydrated,  setIsHydrated]  = useState(false);

  const doRefreshRef = useRef(null);
  const doLogoutRef  = useRef(null);

  const scheduleRefresh = useCallback((token) => {
    const expiry = tokenExpiry(token);
    if (!expiry) return;
    const delay = expiry - Date.now() - 2 * 60 * 1000;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay <= 0) { doRefreshRef.current?.(); return; }
    timerRef.current = setTimeout(() => doRefreshRef.current?.(), delay);
  }, []);

  const doLogout = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    clearSession();
    if (timerRef.current) clearTimeout(timerRef.current);
    setUser(null);
    setAccessToken(null);
    router.push("/login");
  }, [router]);

  const doRefresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method:      "POST",
        credentials: "same-origin",
        headers:     { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Refresh failed");
      const { accessToken: newAccess } = await res.json();
      const { user: storedUser } = getStored();
      if (storedUser) saveSession(newAccess, storedUser);
      setAccessToken(newAccess);
      scheduleRefresh(newAccess);
      return newAccess;
    } catch {
      doLogoutRef.current?.();
      return null;
    }
  }, [scheduleRefresh]);

  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);
  useEffect(() => { doLogoutRef.current  = doLogout;  }, [doLogout]);

  useEffect(() => {
    const { access, user: storedUser } = getStored();
    if (access && storedUser) {
      const expiry = tokenExpiry(access);
      if (expiry && expiry > Date.now()) {
        setUser(storedUser);
        setAccessToken(access);
        scheduleRefresh(access);
        setIsHydrated(true);
      } else {
        doRefresh().then((newToken) => {
          if (newToken) {
            const { user: u } = getStored();
            setUser(u);
          }
          setIsHydrated(true);
        });
      }
    } else {
      setIsHydrated(true);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    try {
      const res  = await fetch("/api/auth/login", {
        method:      "POST",
        credentials: "same-origin",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      saveSession(data.accessToken, data.user);
      setUser(data.user);
      setAccessToken(data.accessToken);
      scheduleRefresh(data.accessToken);
      router.push(data.user.role === "ADMIN" ? "/admin/dashboard" : "/employee/dashboard");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [router, scheduleRefresh]);

  const accessTokenRef = useRef(accessToken);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

  const authFetch = useCallback(async (url, options = {}) => {
    let token = accessTokenRef.current;

    if (token) {
      const exp = tokenExpiry(token);
      if (exp && exp <= Date.now()) {
        token = await doRefreshRef.current?.() ?? null;
      }
    }

    const makeRequest = (t) => fetch(url, {
      ...options,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });

    const res = await makeRequest(token);

    if (res.status === 401) {
      const newToken = await doRefreshRef.current?.() ?? null;
      if (!newToken) { doLogoutRef.current?.(); throw new Error("Session expired"); }
      return makeRequest(newToken);
    }

    return res;
  }, []);

  return {
    user,
    accessToken,
    isLoading,
    isHydrated,
    isLoggedIn: !!user,
    isAdmin:    user?.role === "ADMIN",
    isEmployee: user?.role === "EMPLOYEE",
    login,
    logout:     doLogout,
    authFetch,
  };
}

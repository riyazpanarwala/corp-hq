// src/hooks/useAuth.js
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const TOKEN_KEY   = "corp_hq_access";
const REFRESH_KEY = "corp_hq_refresh";
const USER_KEY    = "corp_hq_user";

function saveTokens(access, refresh, user) {
  localStorage.setItem(TOKEN_KEY,   access);
  localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(USER_KEY,    JSON.stringify(user));
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function getStored() {
  if (typeof window === "undefined")
    return { access: null, refresh: null, user: null };
  try {
    return {
      access:  localStorage.getItem(TOKEN_KEY),
      refresh: localStorage.getItem(REFRESH_KEY),
      user:    JSON.parse(localStorage.getItem(USER_KEY) || "null"),
    };
  } catch {
    return { access: null, refresh: null, user: null };
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

  const [user,         setUser]         = useState(null);
  const [accessToken,  setAccessToken]  = useState(null);
  const [isLoading,    setIsLoading]    = useState(false);
  const [isHydrated,   setIsHydrated]   = useState(false);

  // MAJOR FIX: Use refs for doRefresh and doLogout so they are always current
  // inside callbacks without creating circular useCallback dependencies.
  // Previously: scheduleRefresh → doRefresh → scheduleRefresh (circular deps),
  // and doRefresh called doLogout (plain function) via stale closure.
  const doRefreshRef = useRef(null);
  const doLogoutRef  = useRef(null);

  // scheduleRefresh only needs the ref, never changes identity
  const scheduleRefresh = useCallback((token) => {
    const expiry = tokenExpiry(token);
    if (!expiry) return;
    const delay = expiry - Date.now() - 2 * 60 * 1000; // refresh 2 min before expiry
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay <= 0) {
      doRefreshRef.current?.();
      return;
    }
    timerRef.current = setTimeout(() => doRefreshRef.current?.(), delay);
  }, []); // no deps — stable forever

  // doLogout — defined once, stored in ref
  const doLogout = useCallback(() => {
    const { refresh } = getStored();
    if (refresh) {
      fetch("/api/auth/logout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refreshToken: refresh }),
      }).catch(() => {});
    }
    clearTokens();
    if (timerRef.current) clearTimeout(timerRef.current);
    setUser(null);
    setAccessToken(null);
    router.push("/login");
  }, [router]);

  // doRefresh — defined once, stored in ref; reads latest state via getStored()
  const doRefresh = useCallback(async () => {
    const { refresh } = getStored();
    if (!refresh) {
      doLogoutRef.current?.();
      return null;
    }
    try {
      const res = await fetch("/api/auth/refresh", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) throw new Error("Refresh failed");
      const { accessToken: newAccess, refreshToken: newRefresh } = await res.json();
      const { user: storedUser } = getStored();
      if (storedUser) saveTokens(newAccess, newRefresh, storedUser);
      setAccessToken(newAccess);
      scheduleRefresh(newAccess);
      return newAccess;
    } catch {
      doLogoutRef.current?.();
      return null;
    }
  }, [scheduleRefresh]); // scheduleRefresh is stable, so doRefresh is also stable

  // Keep refs in sync with latest function versions
  useEffect(() => { doRefreshRef.current = doRefresh; }, [doRefresh]);
  useEffect(() => { doLogoutRef.current  = doLogout;  }, [doLogout]);

  // Hydrate on mount — read localStorage, validate/refresh token
  useEffect(() => {
    const { access, user: storedUser } = getStored();
    if (access && storedUser) {
      const expiry = tokenExpiry(access);
      if (expiry && expiry > Date.now()) {
        // Token still valid
        setUser(storedUser);
        setAccessToken(access);
        scheduleRefresh(access);
        setIsHydrated(true);
      } else {
        // Token expired — try to refresh before marking hydrated
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
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []); // intentionally empty — runs once on mount only

  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    try {
      const res  = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      saveTokens(data.accessToken, data.refreshToken, data.user);
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

  // MAJOR FIX: authFetch no longer depends on `accessToken` state directly.
  // Instead it reads the latest token from the ref so it doesn't go stale
  // between re-renders and doesn't trigger re-renders of all consumers on
  // every 15-minute token refresh.
  const accessTokenRef = useRef(accessToken);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

  const authFetch = useCallback(async (url, options = {}) => {
    let token = accessTokenRef.current;

    // Proactively refresh if token is expired or about to expire
    if (token) {
      const exp = tokenExpiry(token);
      if (exp && exp <= Date.now()) {
        token = await doRefreshRef.current?.() ?? null;
      }
    }

    const makeRequest = (t) => fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    });

    const res = await makeRequest(token);

    // 401 → attempt one refresh then retry
    if (res.status === 401) {
      const newToken = await doRefreshRef.current?.() ?? null;
      if (!newToken) {
        doLogoutRef.current?.();
        throw new Error("Session expired");
      }
      return makeRequest(newToken);
    }

    return res;
  }, []); // stable forever — reads token via ref, calls logout/refresh via refs

  return {
    user,
    accessToken,
    isLoading,
    isHydrated,
    isLoggedIn:  !!user,
    isAdmin:     user?.role === "ADMIN",
    isEmployee:  user?.role === "EMPLOYEE",
    login,
    logout:      doLogout,
    authFetch,
  };
}

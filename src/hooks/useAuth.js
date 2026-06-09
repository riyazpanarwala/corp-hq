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

// Derive canonical user fields from the server-signed JWT payload.
// Falls back to null if the token is malformed.
function userFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return {
      id:    Number(payload.sub),
      email: payload.email,
      name:  payload.name,
      role:  payload.role,
    };
  } catch {
    return null;
  }
}

// Perform the refresh network call with no React state dependencies.
// Returns the new access token string, or null on failure.
// This is a plain async function (not a hook) so it can be called safely
// from the hydration useEffect before any refs are populated.
async function fetchNewToken() {
  const res = await fetch("/api/auth/refresh", {
    method:      "POST",
    credentials: "same-origin",
    headers:     { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Refresh failed");
  const { accessToken } = await res.json();
  return accessToken;
}

export function useAuth() {
  const router   = useRouter();
  const timerRef = useRef(null);

  const [user,        setUser]        = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading,   setIsLoading]   = useState(false);
  const [isHydrated,  setIsHydrated]  = useState(false);

  const doRefreshRef      = useRef(null);
  const doLogoutRef       = useRef(null);
  // Coalesce concurrent refresh calls: /api/auth/refresh rotates the cookie,
  // so two overlapping calls race — the second sends the stale cookie, fails,
  // and triggers logout. One shared in-flight promise prevents this.
  const refreshPromiseRef = useRef(null);

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
    refreshPromiseRef.current = null;
    setUser(null);
    setAccessToken(null);
    router.push("/login");
  }, [router]);

  const doRefresh = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const promise = (async () => {
      try {
        const newAccess = await fetchNewToken();
        // Derive user from the fresh server-signed token — never from stale localStorage
        const freshUser = userFromToken(newAccess);
        if (freshUser) {
          // Merge with stored user to preserve richer fields (department,
          // designation etc.) that the token payload doesn't carry
          const { user: storedUser } = getStored();
          const mergedUser = storedUser ? { ...storedUser, ...freshUser } : freshUser;
          saveSession(newAccess, mergedUser);
          setUser(mergedUser);
        }
        setAccessToken(newAccess);
        scheduleRefresh(newAccess);
        return newAccess;
      } catch {
        doLogoutRef.current?.();
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = promise;
    return promise;
  }, [scheduleRefresh]);

  // Populate refs synchronously before any async work can reference them
  doRefreshRef.current = doRefresh;
  doLogoutRef.current  = doLogout;

  // ── Hydration ─────────────────────────────────────────────────────────────
  // FIX: Previously doRefresh was called directly from this effect, but
  // doLogoutRef was populated in a separate useEffect that hadn't run yet at
  // this point, so a refresh failure silently left user=null and isHydrated=true
  // → blank screen.  Now refs are assigned inline above (before the effect runs)
  // so they're always populated when the async path executes.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const { access, user: storedUser } = getStored();

      if (!access || !storedUser) {
        setIsHydrated(true);
        return;
      }

      const expiry = tokenExpiry(access);
      if (expiry && expiry > Date.now()) {
        // Token still valid — derive user from payload, fall back to stored
        const freshUser = userFromToken(access) ?? storedUser;
        const mergedUser = { ...storedUser, ...freshUser };
        if (!cancelled) {
          setUser(mergedUser);
          setAccessToken(access);
          scheduleRefresh(access);
          setIsHydrated(true);
        }
        return;
      }

      // Token expired — attempt refresh.
      // doLogoutRef.current is guaranteed set (inline assignment above).
      try {
        const newAccess = await fetchNewToken();
        if (cancelled) return;
        const freshUser  = userFromToken(newAccess);
        const mergedUser = freshUser ? { ...storedUser, ...freshUser } : storedUser;
        saveSession(newAccess, mergedUser);
        setUser(mergedUser);
        setAccessToken(newAccess);
        scheduleRefresh(newAccess);
      } catch {
        // Refresh failed — clear session and redirect to login
        if (!cancelled) {
          clearSession();
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    };

    hydrate();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
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

      // Login response carries the full user object (department, designation,
      // timezone, avatarUrl etc.) which the JWT payload doesn't include.
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

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
    // Coalescing guard — return the in-flight promise if one exists so
    // concurrent callers (hydration, timer, authFetch) share one request.
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const promise = (async () => {
      try {
        const res = await fetch("/api/auth/refresh", {
          method:      "POST",
          credentials: "same-origin",
          headers:     { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error("Refresh failed");
        const { accessToken: newAccess } = await res.json();

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

  // Assign refs inline (before any effect runs) so they are always populated
  // when async code inside effects calls doRefreshRef.current or doLogoutRef.current.
  // Using separate useEffect(() => { ref.current = fn }, [fn]) would defer the
  // assignment until after paint, causing a null-ref on the very first render.
  doRefreshRef.current = doRefresh;
  doLogoutRef.current  = doLogout;

  // ── Hydration ─────────────────────────────────────────────────────────────
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
        const freshUser  = userFromToken(access) ?? storedUser;
        const mergedUser = { ...storedUser, ...freshUser };
        if (!cancelled) {
          setUser(mergedUser);
          setAccessToken(access);
          scheduleRefresh(access);
          setIsHydrated(true);
        }
        return;
      }

      // Token expired — attempt refresh via doRefreshRef so the concurrency
      // guard (refreshPromiseRef) is respected. If authFetch fires a 401 retry
      // during this await and also calls doRefresh, both callers share the same
      // in-flight promise instead of sending two requests with the rotating cookie.
      try {
        const newAccess = await doRefreshRef.current?.();
        if (!newAccess) throw new Error("Refresh failed");
        if (cancelled) return;
        // doRefresh already called setUser/setAccessToken/scheduleRefresh/saveSession
        // internally — nothing more to do here.
      } catch {
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

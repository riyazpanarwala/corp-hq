// src/hooks/useAuth.js
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

const TOKEN_KEY = "corp_hq_access";
const REFRESH_KEY = "corp_hq_refresh";
const USER_KEY = "corp_hq_user";

function saveTokens(access, refresh, user) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
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
      access: localStorage.getItem(TOKEN_KEY),
      refresh: localStorage.getItem(REFRESH_KEY),
      user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
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
  const router = useRouter();
  const timerRef = useRef(null);
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const scheduleRefresh = useCallback((token) => {
    const expiry = tokenExpiry(token);
    if (!expiry) return;
    const delay = expiry - Date.now() - 2 * 60 * 1000;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (delay <= 0) {
      doRefresh();
      return;
    }
    timerRef.current = setTimeout(doRefresh, delay);
  }, []);

  const doRefresh = useCallback(async () => {
    const { refresh } = getStored();
    if (!refresh) {
      doLogout();
      return null;
    }
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok) throw new Error();
      const { accessToken: newAccess, refreshToken: newRefresh } =
        await res.json();
      const { user: storedUser } = getStored();
      if (storedUser) saveTokens(newAccess, newRefresh, storedUser);
      setAccessToken(newAccess);
      scheduleRefresh(newAccess);
      return newAccess;
    } catch {
      doLogout();
      return null;
    }
  }, [scheduleRefresh]);

  // Hydrate on mount
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
          const { user: u } = getStored();
          setUser(u);
          setAccessToken(newToken);
          setIsHydrated(true);
        });
      }
    } else {
      setIsHydrated(true);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const login = useCallback(
    async (email, password) => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        saveTokens(data.accessToken, data.refreshToken, data.user);
        setUser(data.user);
        setAccessToken(data.accessToken);
        scheduleRefresh(data.accessToken);
        router.push(
          data.user.role === "ADMIN"
            ? "/admin/dashboard"
            : "/employee/dashboard",
        );
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        setIsLoading(false);
      }
    },
    [router, scheduleRefresh],
  );

  function doLogout() {
    const { refresh } = getStored();
    if (refresh)
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      }).catch(() => {});
    clearTokens();
    if (timerRef.current) clearTimeout(timerRef.current);
    setUser(null);
    setAccessToken(null);
    router.push("/login");
  }

  const authFetch = useCallback(
    async (url, options = {}) => {
      let token = accessToken;
      if (token) {
        const exp = tokenExpiry(token);
        if (exp && exp <= Date.now()) token = await doRefresh();
      }
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.status === 401) {
        const newToken = await doRefresh();
        if (!newToken) {
          doLogout();
          throw new Error("Session expired");
        }
        return fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
            Authorization: `Bearer ${newToken}`,
          },
        });
      }
      return res;
    },
    [accessToken, doRefresh],
  );

  return {
    user,
    accessToken,
    isLoading,
    isHydrated,
    isLoggedIn: !!user,
    isAdmin: user?.role === "ADMIN",
    isEmployee: user?.role === "EMPLOYEE",
    login,
    logout: doLogout,
    authFetch,
  };
}

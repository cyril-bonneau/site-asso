import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';

const AuthCtx = createContext(null)

export function useAuth() {
    const ctx = useContext(AuthCtx)
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
    return ctx
}

export function AuthProvider({ children }) {
    const [accessToken, setAccessToken] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const latestAccessToken = useRef(accessToken)
    useEffect(() => { latestAccessToken.current = accessToken }, [accessToken])

    // SIGNIN -> pose cookie refresh + renvoie {accessToken}
    const login = useCallback(async (email, password) => {
        setError(null)
        const res = await fetch('/api/signin', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        })
        if (!res.ok) {
            setAccessToken(null)
            setError(await readErr(res) || 'Signin failed')
            return false
        }
        const data = await res.json()
        setAccessToken(data.accessToken ?? null)
        return true
    }, [setAccessToken, setError])

    // REFRESH -> utilise le cookie refresh HttpOnly
    const refresh = useCallback(async () => {
        setError(null)
        const res = await fetch('/api/refresh', {
            method: 'POST',
            credentials: 'include'
        })
        if (!res.ok) {
            setAccessToken(null)
            const msg = await readErr(res)
            if (msg) setError(msg)
            return false
        }
        const data = await res.json()
        setAccessToken(data.accessToken ?? null)
        return !!data.accessToken
    }, [])

    const logout = useCallback(async () => {
        try {
            await fetch('/api/logout', { method: 'POST', credentials: 'include' })
        } finally {
            setAccessToken(null)
            setError(null)
        }
    }, [setAccessToken, setError])

    // fetch protégé : ajoute Authorization + retry après refresh si 401
    const authFetch = useCallback(async (input, init = {}) => {
        const headers = new Headers(init.headers || {});
        if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

        const doFetch = (opts) =>
            fetch(input, { ...opts, headers, credentials: 'include' });

        let res = await doFetch(init);

        if (res.status === 401) {
            const ok = await refresh(); // utilise le cookie refresh côté serveur
            if (ok && latestAccessToken.current) {
                const headers2 = new Headers(init.headers || {});
                headers2.set('Authorization', `Bearer ${latestAccessToken.current}`);
                res = await fetch(input, {
                    ...init,
                    headers: headers2,
                    credentials: 'include',
                });
            }
        }
        return res;
    }, [accessToken, refresh]);

    // réhydrater au démarrage (si cookie refresh présent)
    useEffect(() => {
        (async () => { try { await refresh() } finally { setLoading(false) } })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const isAuthenticated = !!accessToken
    const value = useMemo(() => ({
        accessToken,
        isAuthenticated,
        loading,
        error,
        setError,
        setAccessToken,
        login,
        logout,
        refresh,
        authFetch,
    }), [accessToken, isAuthenticated, loading, error, refresh, authFetch, logout, login])

    return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

async function readErr(res) {
    try {
        const data = await res.json()
        return data?.error || data?.message || null
    } catch { return null }
}
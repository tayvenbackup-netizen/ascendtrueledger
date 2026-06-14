import { useState, useEffect, useCallback, useRef } from 'react';
import { encryptToStorage, decryptFromStorage } from '@/lib/secureStorage';
import { setAuthState } from '@/lib/authState';

interface SessionInfo {
  session_token: string;
  csrf_token?: string;
  key_type: 'weekly' | 'monthly' | 'lifetime' | 'daily' | '3day' | 'admin';
  activated_at: string;
  expires_at: string | null;
  is_admin?: boolean;
  is_sub_admin?: boolean;
  sub_admin_id?: string;
  key_name?: string | null;
  key_preview?: string | null;
}

const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-key`;
const SESSION_STORAGE_KEY = 'tl_ac_session_v2';
const API_TIMEOUT_MS = 12000;

function getDeviceFingerprint(): string {
  const signals = [
    navigator.userAgent, navigator.language,
    screen.width + 'x' + screen.height, screen.colorDepth?.toString() ?? '',
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() ?? '',
    (navigator as any).deviceMemory?.toString() ?? '',
    navigator.platform ?? '', navigator.maxTouchPoints?.toString() ?? '',
  ].join('|');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < signals.length; i++) {
    const ch = signals.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const DEVICE_FP = getDeviceFingerprint();

async function loadPersistedSession(): Promise<SessionInfo | null> {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const decrypted = await decryptFromStorage(raw, DEVICE_FP);
    if (!decrypted) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
    const parsed = JSON.parse(decrypted);
    if (!parsed?.csrf_token) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
    return parsed;
  } catch { return null; }
}
async function persistSession(session: SessionInfo | null) {
  try {
    if (session) {
      const encrypted = await encryptToStorage(JSON.stringify(session), DEVICE_FP);
      localStorage.setItem(SESSION_STORAGE_KEY, encrypted);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {}
}

let memorySession: SessionInfo | null = null;
const sessionReady: Promise<void> = loadPersistedSession().then(s => { memorySession = s; });

async function callApi(action: string, body: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (memorySession?.csrf_token) headers['x-csrf-token'] = memorySession.csrf_token;
  let res: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    res = await fetch(API_URL, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ action, ...body }), signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Connection timed out. Refresh and try again.');
    throw new Error('Connection blocked. Refresh and try again.');
  } finally {
    window.clearTimeout(timeout);
  }

  let data: any = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }

  if (!res.ok && res.status !== 200) {
    throw new Error(data?.error || `API error ${res.status}`);
  }
  return data || {};
}

export function useAccessControl() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBypassed, setIsBypassed] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateSessionFromResponse = useCallback(async (data: any, fallback?: Partial<SessionInfo>): Promise<SessionInfo> => {
    const updated: SessionInfo = {
      session_token: data.session_token || memorySession?.session_token || '',
      csrf_token: data.csrf_token || memorySession?.csrf_token,
      key_type: data.key_type || fallback?.key_type || memorySession?.key_type || 'weekly',
      activated_at: data.activated_at || fallback?.activated_at || memorySession?.activated_at || '',
      expires_at: data.expires_at ?? fallback?.expires_at ?? memorySession?.expires_at ?? null,
      is_admin: data.is_admin || false,
      is_sub_admin: data.is_sub_admin || false,
      sub_admin_id: data.sub_admin_id || undefined,
      key_name: data.key_name ?? memorySession?.key_name ?? null,
      key_preview: data.key_preview ?? memorySession?.key_preview ?? null,
    };
    memorySession = updated;
    await persistSession(updated);
    setAuthState({ ready: true, authed: true, csrfToken: updated.csrf_token || null, sessionToken: updated.session_token || null });
    return updated;
  }, []);

  const checkSession = useCallback(async () => {
    await sessionReady;
    const token = memorySession?.session_token;
    try {
      const data = await callApi('check_session', token ? { session_token: token } : {});
      if (data.valid) {
        const updated = await updateSessionFromResponse(data);
        setSession(updated);
        setIsAdmin(!!data.is_admin);
        setIsAuthed(true);
        setIsLoading(false);
        return;
      }
    } catch {}
    memorySession = null;
    await persistSession(null);
    setIsAuthed(false);
    setIsAdmin(false);
    setSession(null);
    setIsLoading(false);
    setAuthState({ ready: true, authed: false, csrfToken: null, sessionToken: null });
  }, [updateSessionFromResponse]);

  const validateKey = useCallback(async (key: string) => {
    setError('');
    try {
      const data = await callApi('validate', { key: key.trim(), device_fingerprint: DEVICE_FP });
      if (data.error) { setError(data.error); return false; }
      const updated = await updateSessionFromResponse(data);
      setSession(updated);
      setIsAdmin(!!data.is_admin);
      setIsAuthed(true);
      return true;
    } catch (e: any) {
      setError(e.message || 'Validation failed');
      return false;
    }
  }, [updateSessionFromResponse]);

  const logout = useCallback(async () => {
    try { await callApi('logout', { session_token: memorySession?.session_token }); } catch {}
    memorySession = null;
    await persistSession(null);
    setIsAuthed(false); setIsAdmin(false); setSession(null);
    setAuthState({ ready: true, authed: false, csrfToken: null, sessionToken: null });
  }, []);

  useEffect(() => { checkSession(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!isLoading) return;
    const t = window.setTimeout(async () => {
      memorySession = null;
      await persistSession(null);
      setIsAuthed(false);
      setIsAdmin(false);
      setSession(null);
      setIsLoading(false);
      setAuthState({ ready: true, authed: false, csrfToken: null, sessionToken: null });
    }, API_TIMEOUT_MS + 3000);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (!isAuthed || !memorySession?.session_token) return;
    const send = async () => {
      try {
        const data = await callApi('session_heartbeat', { session_token: memorySession?.session_token });
        if (data?.revoked) { logout(); }
      } catch {}
    };
    const t = setTimeout(() => { send(); intervalRef.current = setInterval(send, 30_000); }, 15_000);
    return () => { clearTimeout(t); if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isAuthed, session?.session_token, logout]);

  return { isAuthed, isAdmin, isLoading, isBypassed, session, error, validateKey, logout };
}

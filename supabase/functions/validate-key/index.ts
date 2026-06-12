const ALLOWED_ORIGIN_PATTERNS = [
  '15f86fd6-9564-48cd-aaee-2da5228aeddb',
  'c65cfa7b-d314-41e4-b873-e652c11be301',
  'lovable.app',
  'lovableproject.com',
  'lovable.dev',
  'trustledger.fun',
  'www.trustledger.fun',
  'trueledgerui.lovable.app',
  'ascendify-seven.vercel.app',
  '.vercel.app',
  'localhost',
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some(p => origin.includes(p));
}

const SESSION_COOKIE_NAME = '__larp_sess';
const CSRF_COOKIE_NAME = '__larp_csrf';
const ADMIN_COOKIE_NAME = '__larp_admin';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const ADMIN_COOKIE_MAX_AGE = SESSION_MAX_AGE;

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = isAllowedOrigin(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-csrf-token, x-session-token, x-admin-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function makeSessionCookie(token: string, maxAge: number = SESSION_MAX_AGE): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}

function makeCsrfCookie(token: string, maxAge: number = SESSION_MAX_AGE): string {
  return `${CSRF_COOKIE_NAME}=${token}; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}
function clearCsrfCookie(): string {
  return `${CSRF_COOKIE_NAME}=; Secure; SameSite=None; Path=/; Max-Age=0`;
}

function makeAdminCookie(token: string, maxAge: number = ADMIN_COOKIE_MAX_AGE): string {
  return `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}
function clearAdminCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
}

function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get('cookie') || '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function getSessionFromCookie(req: Request): string | null {
  return getCookie(req, SESSION_COOKIE_NAME);
}

function makeAuthHeaders(sessionToken: string, csrfToken: string): Headers {
  const h = new Headers();
  h.append('Set-Cookie', makeSessionCookie(sessionToken));
  h.append('Set-Cookie', makeCsrfCookie(csrfToken));
  return h;
}

function makeClearAuthHeaders(): Headers {
  const h = new Headers();
  h.append('Set-Cookie', clearSessionCookie());
  h.append('Set-Cookie', clearCsrfCookie());
  return h;
}

function generateCsrfToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bindCsrfToSession(supabase: any, sessionToken: string, csrfToken: string) {
  const tokHash = await sha256Hash(sessionToken);
  await supabase.from('app_settings').upsert({
    id: `csrf:${tokHash}`,
    value: { csrf_token: csrfToken, created_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
}

function isLikelyBrowser(req: Request): boolean {
  const ua = req.headers.get('user-agent') || '';
  const origin = req.headers.get('origin') || '';
  if (!ua || ua.length < 10) return false;
  if (!origin || !isAllowedOrigin(origin)) return false;
  const lower = ua.toLowerCase();
  const blocked = ['curl/', 'wget/', 'python-requests', 'go-http-client', 'postmanruntime', 'insomnia'];
  if (blocked.some(b => lower.includes(b))) return false;
  return true;
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function checkRateLimitDB(
  supabase: any,
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const rateLimitId = `rate_limit:${key}`;
  const { data } = await supabase
    .from('app_settings').select('value').eq('id', rateLimitId).maybeSingle();

  const now = Date.now();
  const entry = data?.value as { attempts: number[]; } | null;

  if (!entry) {
    await supabase.from('app_settings').upsert({
      id: rateLimitId,
      value: { attempts: [now] },
      updated_at: new Date().toISOString(),
    });
    return true;
  }

  const recentAttempts = (entry.attempts || []).filter((t: number) => t > now - windowMs);
  if (recentAttempts.length >= max) return false;

  recentAttempts.push(now);
  await supabase.from('app_settings').upsert({
    id: rateLimitId,
    value: { attempts: recentAttempts },
    updated_at: new Date().toISOString(),
  });
  return true;
}

const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX_VALIDATE = 5;
const RATE_LIMIT_MAX_ADMIN = 3;
const RATE_LIMIT_MAX_GLOBAL = 60;

async function hmacHash(key: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(key));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function getAdminPassword(): string {
  const pw = Deno.env.get('ADMIN_PASSWORD');
  if (!pw) throw new Error('ADMIN_PASSWORD secret not configured');
  return pw;
}

function getAdminMasterKey(): string {
  const mk = Deno.env.get('ADMIN_MASTER_KEY');
  if (!mk) throw new Error('ADMIN_MASTER_KEY secret not configured');
  return mk;
}

let adminPasswordHash: string | null = null;
let adminMasterKeyHash: string | null = null;

async function getAdminPasswordHash(pepper: string, supabase?: any): Promise<string> {
  // Check for emergency master-reset override stored in app_settings
  if (supabase) {
    try {
      const { data } = await supabase.from('app_settings').select('value').eq('id', 'admin_password_override_hash').maybeSingle();
      const v: any = data?.value;
      if (v && typeof v.hash === 'string' && v.hash.length > 0) return v.hash;
    } catch {}
  }
  if (!adminPasswordHash) adminPasswordHash = await hmacHash(getAdminPassword(), pepper);
  return adminPasswordHash;
}
async function getAdminMasterKeyHash(pepper: string): Promise<string> {
  if (!adminMasterKeyHash) adminMasterKeyHash = await hmacHash(getAdminMasterKey(), pepper);
  return adminMasterKeyHash;
}

function isPrivateIP(ip: string): boolean {
  if (!ip) return true;
  const s = ip.trim().toLowerCase();
  if (s === 'unknown' || s === '::1' || s === '::' || s === '0.0.0.0') return true;
  if (s.startsWith('127.') || s.startsWith('10.') || s.startsWith('192.168.')) return true;
  if (s.startsWith('169.254.') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:')) return true;
  // 172.16.0.0/12
  const m = s.match(/^172\.(\d+)\./);
  if (m) { const n = parseInt(m[1], 10); if (n >= 16 && n <= 31) return true; }
  // 100.64.0.0/10 CGNAT
  const c = s.match(/^100\.(\d+)\./);
  if (c) { const n = parseInt(c[1], 10); if (n >= 64 && n <= 127) return true; }
  return false;
}

function getClientIP(req: Request): string {
  // Priority order: most trusted edge headers first
  const candidates: string[] = [];
  const push = (v: string | null) => { if (v) candidates.push(...v.split(',').map(x => x.trim())); };
  push(req.headers.get('cf-connecting-ip'));
  push(req.headers.get('true-client-ip'));
  push(req.headers.get('fly-client-ip'));
  push(req.headers.get('x-real-ip'));
  push(req.headers.get('x-forwarded-for'));
  push(req.headers.get('forwarded')?.match(/for=([^;,\s]+)/i)?.[1]?.replace(/^"|"$|\[|\]/g, '') || null);
  for (const raw of candidates) {
    if (!raw) continue;
    // strip ipv6 brackets and ports
    let ip = raw.replace(/^\[/, '').replace(/\]$/, '').replace(/^"|"$/g, '');
    const portIdx = ip.lastIndexOf(':');
    if (portIdx > -1 && ip.indexOf(':') === portIdx) ip = ip.slice(0, portIdx); // ipv4:port
    if (!isPrivateIP(ip)) return ip;
  }
  return 'unknown';
}

type GeoInfo = { country: string | null; region: string | null; city: string | null; lat?: number | null; lon?: number | null };
const geoCache = new Map<string, { at: number; data: GeoInfo }>();
const GEO_TTL_MS = 60 * 60_000;

function mergeGeo(a: GeoInfo, b: GeoInfo): GeoInfo {
  return {
    country: a.country || b.country || null,
    region:  a.region  || b.region  || null,
    city:    a.city    || b.city    || null,
    lat: a.lat ?? b.lat ?? null,
    lon: a.lon ?? b.lon ?? null,
  };
}

async function fetchJson(url: string, ms = 2000): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function lookupGeo(ip: string, req?: Request): Promise<GeoInfo> {
  let acc: GeoInfo = { country: null, region: null, city: null, lat: null, lon: null };

  // Always seed from CDN edge headers if present (these are highly reliable)
  if (req) {
    const cfCountry = req.headers.get('cf-ipcountry');
    const cfCity = req.headers.get('cf-ipcity');
    const cfRegion = req.headers.get('cf-region');
    const vercelCountry = req.headers.get('x-vercel-ip-country');
    const vercelCity = req.headers.get('x-vercel-ip-city');
    const vercelRegion = req.headers.get('x-vercel-ip-country-region');
    const vercelLat = req.headers.get('x-vercel-ip-latitude');
    const vercelLon = req.headers.get('x-vercel-ip-longitude');
    acc = mergeGeo(acc, {
      country: cfCountry || vercelCountry || null,
      region:  cfRegion  || vercelRegion  || null,
      city:    cfCity    || (vercelCity ? decodeURIComponent(vercelCity) : null),
      lat: vercelLat ? parseFloat(vercelLat) : null,
      lon: vercelLon ? parseFloat(vercelLon) : null,
    });
  }

  if (!ip || isPrivateIP(ip)) return acc;

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.at < GEO_TTL_MS) return mergeGeo(acc, cached.data);

  // Query multiple providers in parallel and merge for max accuracy
  const enc = encodeURIComponent(ip);
  const [a, b, c] = await Promise.all([
    fetchJson(`https://ipapi.co/${enc}/json/`),
    fetchJson(`http://ip-api.com/json/${enc}?fields=status,country,regionName,city,lat,lon`),
    fetchJson(`https://ipwho.is/${enc}`),
  ]);

  let data: GeoInfo = { country: null, region: null, city: null, lat: null, lon: null };

  if (a && !a.error) {
    data = mergeGeo(data, {
      country: a.country_name || a.country || null,
      region: a.region || a.region_code || null,
      city: a.city || null,
      lat: typeof a.latitude === 'number' ? a.latitude : null,
      lon: typeof a.longitude === 'number' ? a.longitude : null,
    });
  }
  if (b && b.status === 'success') {
    data = mergeGeo(data, {
      country: b.country || null,
      region: b.regionName || null,
      city: b.city || null,
      lat: typeof b.lat === 'number' ? b.lat : null,
      lon: typeof b.lon === 'number' ? b.lon : null,
    });
  }
  if (c && c.success !== false) {
    data = mergeGeo(data, {
      country: c.country || null,
      region: c.region || null,
      city: c.city || null,
      lat: typeof c.latitude === 'number' ? c.latitude : null,
      lon: typeof c.longitude === 'number' ? c.longitude : null,
    });
  }

  geoCache.set(ip, { at: Date.now(), data });
  return mergeGeo(acc, data);
}

function isForeignLocation(activation: GeoInfo, attempt: GeoInfo): boolean {
  if (!attempt.country && !attempt.region && !attempt.city) return false;
  if (!activation.country && !activation.region && !activation.city) return false;
  const norm = (s: string | null) => (s || '').trim().toLowerCase();
  if (activation.country && attempt.country && norm(activation.country) !== norm(attempt.country)) return true;
  if (activation.region  && attempt.region  && norm(activation.region)  !== norm(attempt.region))  return true;
  if (activation.city    && attempt.city    && norm(activation.city)    !== norm(attempt.city))    return true;
  return false;
}

async function audit(
  supabase: any,
  params: {
    actor_type: 'master' | 'sub_admin';
    actor_id?: string | null;
    actor_label?: string | null;
    action: string;
    target_type?: string | null;
    target_id?: string | null;
    target_label?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
    success?: boolean;
  },
) {
  try {
    await supabase.from('audit_logs').insert({
      actor_type: params.actor_type,
      actor_id: params.actor_id ?? null,
      actor_label: params.actor_label ?? (params.actor_type === 'master' ? 'master' : null),
      action: params.action,
      target_type: params.target_type ?? null,
      target_id: params.target_id ?? null,
      target_label: params.target_label ?? null,
      metadata: params.metadata ?? {},
      ip_address: params.ip ?? null,
      success: params.success !== false,
    });
  } catch (e) {
    console.error('audit log write failed', e);
  }
}

const ADMIN_ACTIONS = new Set([
  'generate_key', 'create_custom_key', 'list_keys', 'rename_key', 'revoke_key', 'delete_key',
  'extend_key',
  'toggle_bypass', 'set_game_modes',
  'refresh_key', 'refresh_all_keys', 'list_device_attempts', 'list_sessions',
  'create_group', 'list_groups', 'update_group', 'delete_group', 'assign_group',
  'create_sub_admin', 'list_sub_admins', 'revoke_sub_admin', 'refresh_sub_admin', 'delete_sub_admin',
  'analytics_summary', 'list_audit_log',
  'list_security_alerts', 'mark_alert_reviewed',
  'generate_bulk_keys', 'list_bulk_keys', 'delete_bulk_group',
  'list_device_requests', 'approve_device_request', 'deny_device_request',
]);

const CSRF_EXEMPT_ACTIONS = new Set([
  'check_bypass',
  'check_session',
  'get_game_modes',
  'validate',
  'admin_auth',
  'sub_admin_auth',
  'admin_logout',
  ...ADMIN_ACTIONS,
]);

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  if (!isLikelyBrowser(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const json = (
    body: unknown,
    _status = 200,
    extra: Record<string, string> | Headers = {},
  ) => {
    const h = new Headers({ ...cors, 'Content-Type': 'application/json' });
    if (extra instanceof Headers) {
      extra.forEach((v, k) => h.append(k, v));
    } else {
      for (const k in extra) h.set(k, extra[k]);
    }
    return new Response(JSON.stringify(body), { status: 200, headers: h });
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PEPPER = serviceKey.slice(0, 32);
    const supabase = createClient(supabaseUrl, serviceKey);
    const clientIP = getClientIP(req);

    if (!(await checkRateLimitDB(supabase, `global:${clientIP}`, RATE_LIMIT_MAX_GLOBAL, RATE_LIMIT_WINDOW))) {
      return json({ error: 'Rate limit exceeded' }, 429);
    }

    const body = await req.json();
    const { action } = body;

    if (!action || typeof action !== 'string') {
      return json({ error: 'Missing action' }, 400);
    }

    if (!CSRF_EXEMPT_ACTIONS.has(action)) {
      const csrfHeader = req.headers.get('x-csrf-token');
      // Collect ALL token candidates — admin and user sessions can coexist
      const candidates = [
        req.headers.get('x-admin-token'),
        getCookie(req, ADMIN_COOKIE_NAME),
        getCookie(req, SESSION_COOKIE_NAME),
        req.headers.get('x-session-token'),
        typeof body.session_token === 'string' ? body.session_token : null,
      ].filter((v): v is string => !!v && typeof v === 'string');
      const csrfCookie = getCookie(req, CSRF_COOKIE_NAME);
      let valid = false;
      if (csrfHeader) {
        for (const tok of candidates) {
          const tokHash = await sha256Hash(tok);
          const { data: adm } = await supabase
            .from('app_settings').select('value').eq('id', `admin_session:${tokHash}`).maybeSingle();
          const stored = (adm?.value as any)?.csrf_token as string | undefined;
          if (stored && timingSafeEqual(stored, csrfHeader)) { valid = true; break; }
          const { data: bind } = await supabase
            .from('app_settings').select('value').eq('id', `csrf:${tokHash}`).maybeSingle();
          const stored2 = (bind?.value as any)?.csrf_token as string | undefined;
          if (stored2 && timingSafeEqual(stored2, csrfHeader)) { valid = true; break; }
        }
        if (!valid && csrfCookie && timingSafeEqual(csrfCookie, csrfHeader)) valid = true;
      }
      if (!valid) return json({ error: 'CSRF validation failed' }, 403);
    }

    if (action === 'check_bypass') {
      const { data } = await supabase.from('app_settings').select('value').eq('id', 'bypass_key').single();
      return json({ bypass: data?.value?.enabled || false });
    }

    if (action === 'get_game_modes') {
      const { data } = await supabase.from('app_settings').select('value').eq('id', 'game_modes').maybeSingle();
      const v = (data?.value as any) || {};
      const normalize = (raw: any, def: 'off' | 'sub' | 'all'): 'off' | 'sub' | 'all' => {
        if (raw === 'off' || raw === 'sub' || raw === 'all') return raw;
        if (raw === true) return 'all';
        if (raw === false) return 'off';
        return def;
      };
      const mines_access     = normalize(v.mines,     'all');
      const blackjack_access = normalize(v.blackjack, 'all');
      const plinko_access    = normalize(v.plinko,    'off');
      return json({
        mines: mines_access !== 'off',
        blackjack: blackjack_access !== 'off',
        plinko: plinko_access !== 'off',
        mines_access, blackjack_access, plinko_access,
      });
    }

    if (action === 'validate') {
      if (!(await checkRateLimitDB(supabase, `validate:${clientIP}`, RATE_LIMIT_MAX_VALIDATE, RATE_LIMIT_WINDOW))) {
        return json({ error: 'Too many attempts. Try again later.' }, 429);
      }

      const { key, device_fingerprint } = body;
      if (!key || typeof key !== 'string' || key.trim().length < 4 || key.trim().length > 200) {
        return json({ error: 'Invalid key format' }, 400);
      }
      if (device_fingerprint && (typeof device_fingerprint !== 'string' || device_fingerprint.length > 200)) {
        return json({ error: 'Invalid device fingerprint' }, 400);
      }

      const trimmedKey = key.trim();
      const fp = device_fingerprint || null;

      // Server-side PC blocking (UA-based) — exempt Lovable preview/dev origins
      const ua = (req.headers.get('user-agent') || '').toLowerCase();
      const reqOrigin = req.headers.get('origin') || '';
      const isPreview = /lovable\.app|lovableproject\.com|lovable\.dev|localhost/.test(reqOrigin);
      const isMobileUA = /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini|webos/.test(ua);
      if (!isMobileUA && !isPreview) {
        return json({ error: 'ONLY WORKS ON MOBILE' }, 403);
      }

      const masterHash = await getAdminMasterKeyHash(PEPPER);
      const inputHash = await hmacHash(trimmedKey, PEPPER);
      if (timingSafeEqual(masterHash, inputHash)) {
        // Bind master key to a single device
        const { data: bindRow } = await supabase
          .from('app_settings').select('value').eq('id', 'master_device_bind').maybeSingle();
        const boundFp = (bindRow?.value as any)?.fp as string | undefined;
        if (boundFp && fp && boundFp !== fp) {
          await new Promise(r => setTimeout(r, 300));
          return json({ error: 'Master key is locked to another device. Contact owner to reset.' }, 401);
        }
        if (!boundFp && fp) {
          await supabase.from('app_settings').upsert({
            id: 'master_device_bind',
            value: { fp, bound_at: new Date().toISOString(), ip: clientIP },
            updated_at: new Date().toISOString(),
          });
        }
        const sessionToken = crypto.randomUUID();
        const sessionTokenHash = await sha256Hash(sessionToken);
        const csrfToken = generateCsrfToken();
        await supabase.from('app_settings').upsert({
          id: `admin_session:${sessionTokenHash}`,
          value: { is_admin: true, created_at: new Date().toISOString(), csrf_token: csrfToken, fp },
          updated_at: new Date().toISOString(),
        });
        return json({
          session_token: sessionToken,
          csrf_token: csrfToken,
          key_type: 'admin',
          activated_at: new Date().toISOString(),
          expires_at: null,
          is_admin: true,
        }, 200, makeAuthHeaders(sessionToken, csrfToken));
      }

      const keyHash = await hmacHash(trimmedKey, PEPPER);
      const legacyHash = await sha256Hash(trimmedKey);

      let keyRow = null;
      const { data: hmacRow } = await supabase
        .from('access_keys').select('*').eq('key_hash', keyHash).eq('is_revoked', false).maybeSingle();
      keyRow = hmacRow;

      if (!keyRow) {
        const { data: legacyRow } = await supabase
          .from('access_keys').select('*').eq('key_hash', legacyHash).eq('is_revoked', false).maybeSingle();
        keyRow = legacyRow;
        if (keyRow) {
          await supabase.from('access_keys').update({ key_hash: keyHash }).eq('id', keyRow.id);
        }
      }

      if (!keyRow) {
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
        return json({ error: 'Invalid or revoked key' }, 401);
      }

      if (keyRow.is_sub_admin) {
        if (fp && keyRow.device_fingerprint && keyRow.device_fingerprint !== fp) {
          return json({ error: 'Admin key locked to another device. Contact owner.' }, 401);
        }
        if (fp && !keyRow.device_fingerprint) {
          await supabase.from('access_keys').update({ device_fingerprint: fp, device_count: 1 }).eq('id', keyRow.id);
        }
        const sessionToken = crypto.randomUUID();
        const sessionTokenHash = await sha256Hash(sessionToken);
        await supabase.from('access_sessions').insert({
          session_token: sessionTokenHash,
          session_token_hash: sessionTokenHash,
          key_id: keyRow.id,
        });
        const csrfToken = generateCsrfToken();
        await bindCsrfToSession(supabase, sessionToken, csrfToken);
        return json({
          session_token: sessionToken,
          csrf_token: csrfToken,
          key_type: keyRow.key_type,
          activated_at: keyRow.activated_at || new Date().toISOString(),
          expires_at: null,
          is_admin: true,
          is_sub_admin: true,
          sub_admin_id: keyRow.id,
        }, 200, makeAuthHeaders(sessionToken, csrfToken));
      }

      if (keyRow.activated_at && keyRow.expires_at) {
        if (new Date() > new Date(keyRow.expires_at)) {
          return json({ error: 'Key has expired' }, 401);
        }
      }

      const attemptGeo = await lookupGeo(clientIP, req);
      const userAgent = req.headers.get('user-agent') || 'Unknown';

      if (fp && keyRow.device_fingerprint && keyRow.device_fingerprint !== fp) {
        // Check if this device has already been pre-approved by an admin
        const { data: approved } = await supabase
          .from('device_requests')
          .select('id')
          .eq('key_id', keyRow.id)
          .eq('device_fingerprint', fp)
          .eq('status', 'approved')
          .limit(1)
          .maybeSingle();

        if (!approved) {
          const activationGeo: GeoInfo = {
            country: keyRow.activation_country || null,
            region:  keyRow.activation_region  || null,
            city:    keyRow.activation_city    || null,
          };
          const foreign = isForeignLocation(activationGeo, attemptGeo);

          await supabase.from('device_attempts').insert({
            key_id: keyRow.id,
            device_fingerprint: fp,
            device_info: userAgent.slice(0, 300),
            ip_address: clientIP,
            blocked: true,
          });

          if (foreign) {
            await supabase.from('security_alerts').insert({
              key_id: keyRow.id,
              attempt_country: attemptGeo.country,
              attempt_region:  attemptGeo.region,
              attempt_city:    attemptGeo.city,
              attempt_ip: clientIP,
              device_fingerprint: fp,
              device_info: userAgent.slice(0, 300),
              reason: 'foreign_location_and_device',
              blocked: true,
            });
            return json({
              error: 'Sign-in blocked: this key was activated in a different location. Contact admin.',
            }, 403);
          }

          // Queue an approval request (only one pending per key+fp at a time)
          const hwid = typeof body.hwid === 'string' ? body.hwid.slice(0, 200) : null;
          const { data: existingPending } = await supabase
            .from('device_requests').select('id')
            .eq('key_id', keyRow.id).eq('device_fingerprint', fp).eq('status', 'pending')
            .maybeSingle();
          if (!existingPending) {
            await supabase.from('device_requests').insert({
              key_id: keyRow.id,
              device_fingerprint: fp,
              hwid,
              ip: clientIP,
              user_agent: userAgent.slice(0, 500),
              country: attemptGeo.country,
              region:  attemptGeo.region,
              city:    attemptGeo.city,
              reason: 'new_device_activation',
            });
          }
          return json({
            pending_approval: true,
            message: 'New device detected. Waiting for admin approval.',
          }, 202);
        }
        // Approved: increment device_count and continue activation flow as a secondary device
        await supabase.from('access_keys').update({
          device_count: (keyRow.device_count || 1) + 1,
          last_seen_at: new Date().toISOString(),
        }).eq('id', keyRow.id);
      }

      if (!keyRow.activated_at) {
        const now = new Date();
        let expiresAt: string | null = null;
        if (keyRow.key_type === 'daily') expiresAt = new Date(now.getTime() + 1 * 86400000).toISOString();
        else if (keyRow.key_type === '3day') expiresAt = new Date(now.getTime() + 3 * 86400000).toISOString();
        else if (keyRow.key_type === 'weekly') expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();
        else if (keyRow.key_type === 'monthly') expiresAt = new Date(now.getTime() + 30 * 86400000).toISOString();
        if (keyRow.expires_at && expiresAt) {
          const preBonusMs = new Date(keyRow.expires_at).getTime() - now.getTime();
          if (preBonusMs > 0) {
            expiresAt = new Date(new Date(expiresAt).getTime() + preBonusMs).toISOString();
          }
        }
        const hwidNew = typeof body.hwid === 'string' ? body.hwid.slice(0, 200) : null;
        await supabase.from('access_keys').update({
          activated_at: now.toISOString(),
          expires_at: expiresAt,
          device_fingerprint: fp,
          device_count: 1,
          activation_country: attemptGeo.country,
          activation_region:  attemptGeo.region,
          activation_city:    attemptGeo.city,
          activation_ip: clientIP,
          activation_user_agent: userAgent.slice(0, 500),
          hwid: hwidNew,
          last_seen_at: now.toISOString(),
        }).eq('id', keyRow.id);
        keyRow.activated_at = now.toISOString();
        keyRow.expires_at = expiresAt;
      } else if (fp && !keyRow.device_fingerprint) {
        const patch: Record<string, unknown> = {
          device_fingerprint: fp,
          device_count: (keyRow.device_count || 0) + 1,
        };
        if (!keyRow.activation_country && (attemptGeo.country || attemptGeo.region || attemptGeo.city)) {
          patch.activation_country = attemptGeo.country;
          patch.activation_region  = attemptGeo.region;
          patch.activation_city    = attemptGeo.city;
          patch.activation_ip      = clientIP;
        }
        await supabase.from('access_keys').update(patch).eq('id', keyRow.id);
      }

      const sessionToken = crypto.randomUUID();
      const sessionTokenHash = await sha256Hash(sessionToken);
      await supabase.from('access_sessions').insert({
        session_token: sessionTokenHash,
        session_token_hash: sessionTokenHash,
        key_id: keyRow.id,
      });

      await supabase.from('key_sessions').insert({
        key_id: keyRow.id,
        session_token: sessionTokenHash,
      });

      await supabase.from('access_keys').update({
        session_count: (keyRow.session_count || 0) + 1,
        last_seen_at: new Date().toISOString(),
      }).eq('id', keyRow.id);

      const csrfToken = generateCsrfToken();
      await bindCsrfToSession(supabase, sessionToken, csrfToken);
      return json({
        session_token: sessionToken,
        csrf_token: csrfToken,
        key_type: keyRow.key_type,
        activated_at: keyRow.activated_at,
        expires_at: keyRow.expires_at,
        key_name: keyRow.key_name || null,
        key_preview: keyRow.key_preview || null,
      }, 200, makeAuthHeaders(sessionToken, csrfToken));
    }

    if (action === 'check_session') {
      const session_token = getSessionFromCookie(req) || body.session_token;
      if (!session_token || typeof session_token !== 'string' || session_token.length > 100) {
        return json({ valid: false }, 200, makeClearAuthHeaders());
      }

      const tokenHash = await sha256Hash(session_token);

      const { data: adminSession } = await supabase
        .from('app_settings').select('value').eq('id', `admin_session:${tokenHash}`).maybeSingle();
      if (adminSession) {
        const newToken = crypto.randomUUID();
        const newTokenHash = await sha256Hash(newToken);
        const newCsrf = generateCsrfToken();
        await supabase.from('app_settings').delete().eq('id', `admin_session:${tokenHash}`);
        await supabase.from('app_settings').upsert({
          id: `admin_session:${newTokenHash}`,
          value: { is_admin: true, created_at: (adminSession.value as any).created_at, csrf_token: newCsrf },
          updated_at: new Date().toISOString(),
        });
        return json({
          valid: true,
          session_token: newToken,
          csrf_token: newCsrf,
          key_type: 'admin',
          activated_at: (adminSession.value as any).created_at,
          expires_at: null,
          is_admin: true,
        }, 200, makeAuthHeaders(newToken, newCsrf));
      }

      let session = null;
      const { data: hashedSession } = await supabase
        .from('access_sessions').select('*, access_keys(*)').eq('session_token_hash', tokenHash).maybeSingle();
      session = hashedSession;

      if (!session) {
        const { data: legacySession } = await supabase
          .from('access_sessions').select('*, access_keys(*)').eq('session_token', session_token).maybeSingle();
        if (legacySession) {
          session = legacySession;
          await supabase.from('access_sessions')
            .update({ session_token: tokenHash, session_token_hash: tokenHash })
            .eq('id', legacySession.id);
        }
      }

      if (!session || !session.access_keys) {
        return json({ valid: false }, 200, makeClearAuthHeaders());
      }

      const keyData = session.access_keys as any;

      if (keyData.is_revoked) {
        await supabase.from('access_sessions').delete().eq('id', session.id);
        return json({ valid: false, reason: 'Key revoked' }, 200, makeClearAuthHeaders());
      }

      if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
        await supabase.from('access_sessions').delete().eq('id', session.id);
        return json({ valid: false, reason: 'Key expired' }, 200, makeClearAuthHeaders());
      }

      const newToken = crypto.randomUUID();
      const newTokenHash = await sha256Hash(newToken);
      await supabase.from('access_sessions')
        .update({ session_token: newTokenHash, session_token_hash: newTokenHash, last_validated: new Date().toISOString() })
        .eq('id', session.id);

      await supabase.from('key_sessions')
        .update({ session_token: newTokenHash }).eq('session_token', tokenHash);

      const newCsrf = generateCsrfToken();
      await supabase.from('app_settings').delete().eq('id', `csrf:${tokenHash}`);
      await bindCsrfToSession(supabase, newToken, newCsrf);
      return json({
        valid: true,
        session_token: newToken,
        csrf_token: newCsrf,
        key_type: keyData.key_type,
        activated_at: keyData.activated_at,
        expires_at: keyData.expires_at,
        is_admin: keyData.is_sub_admin ? true : false,
        is_sub_admin: keyData.is_sub_admin || false,
        sub_admin_id: keyData.is_sub_admin ? keyData.id : undefined,
        key_name: keyData.key_name || null,
        key_preview: keyData.key_preview || null,
      }, 200, makeAuthHeaders(newToken, newCsrf));
    }

    if (action === 'session_heartbeat') {
      const session_token = getSessionFromCookie(req) || body.session_token;
      if (!session_token || typeof session_token !== 'string') {
        return json({ error: 'Missing session_token' }, 400);
      }
      const tokenHash = await sha256Hash(session_token);

      const { data: ks } = await supabase
        .from('key_sessions').select('id, key_id, started_at')
        .eq('session_token', tokenHash).order('started_at', { ascending: false }).limit(1).maybeSingle();

      let liveExpiresAt: string | null = null;
      let liveRevoked = false;
      if (ks) {
        const elapsed = Math.floor((Date.now() - new Date(ks.started_at).getTime()) / 1000);
        await supabase.from('key_sessions').update({
          last_heartbeat: new Date().toISOString(),
          duration_seconds: elapsed,
        }).eq('id', ks.id);

        const { data: sessions } = await supabase
          .from('key_sessions').select('duration_seconds').eq('key_id', ks.key_id);
        const totalSeconds = (sessions || []).reduce((s: number, r: any) => s + (r.duration_seconds || 0), 0);
        await supabase.from('access_keys').update({ total_play_seconds: totalSeconds }).eq('id', ks.key_id);

        const { data: keyRow } = await supabase
          .from('access_keys').select('expires_at, is_revoked').eq('id', ks.key_id).maybeSingle();
        if (keyRow) {
          liveExpiresAt = keyRow.expires_at;
          liveRevoked = !!keyRow.is_revoked;
        }
      }

      return json({ success: true, expires_at: liveExpiresAt, revoked: liveRevoked });
    }

    if (action === 'logout') {
      const session_token = getSessionFromCookie(req) || body.session_token;
      if (session_token && typeof session_token === 'string') {
        const tokenHash = await sha256Hash(session_token);
        await supabase.from('access_sessions').delete().eq('session_token_hash', tokenHash);
        await supabase.from('app_settings').delete().eq('id', `admin_session:${tokenHash}`);
      }
      return json({ success: true }, 200, makeClearAuthHeaders());
    }

    if (action === 'admin_auth') {
      if (!(await checkRateLimitDB(supabase, `admin:${clientIP}`, RATE_LIMIT_MAX_ADMIN, RATE_LIMIT_WINDOW))) {
        return json({ error: 'Too many attempts. Locked for 1 minute.' }, 429);
      }
      const { admin_password } = body;
      if (!admin_password || typeof admin_password !== 'string') {
        return json({ error: 'Missing password' }, 400);
      }
      const pwHash = await hmacHash(admin_password, PEPPER);
      const expectedHash = await getAdminPasswordHash(PEPPER, supabase);
      if (!timingSafeEqual(pwHash, expectedHash)) {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        await audit(supabase, { actor_type: 'master', action: 'admin_login_failed', ip: clientIP, success: false });
        return json({ error: 'Wrong password' }, 401);
      }
      const adminToken = crypto.randomUUID();
      const adminTokenHash = await sha256Hash(adminToken);
      const csrfToken = generateCsrfToken();
      await supabase.from('app_settings').upsert({
        id: `admin_session:${adminTokenHash}`,
        value: { kind: 'master', last_active: Date.now(), created_at: new Date().toISOString(), csrf_token: csrfToken },
        updated_at: new Date().toISOString(),
      });
      const h = new Headers();
      h.append('Set-Cookie', makeCsrfCookie(csrfToken));
      h.append('Set-Cookie', makeAdminCookie(adminToken));
      await audit(supabase, { actor_type: 'master', action: 'admin_login', ip: clientIP });
      return json({ success: true, is_master: true, csrf_token: csrfToken, admin_token: adminToken }, 200, h);
    }

    if (action === 'sub_admin_auth') {
      if (!(await checkRateLimitDB(supabase, `admin:${clientIP}`, RATE_LIMIT_MAX_ADMIN, RATE_LIMIT_WINDOW))) {
        return json({ error: 'Too many attempts. Locked for 1 minute.' }, 429);
      }
      const { sub_admin_id } = body;
      if (!sub_admin_id) return json({ error: 'Missing sub_admin_id' }, 400);
      const { data: adminKey } = await supabase
        .from('access_keys').select('id, is_sub_admin, is_revoked, key_name')
        .eq('id', sub_admin_id).eq('is_sub_admin', true).eq('is_revoked', false).maybeSingle();
      if (!adminKey) {
        await audit(supabase, { actor_type: 'sub_admin', actor_id: sub_admin_id, action: 'admin_login_failed', ip: clientIP, success: false });
        return json({ error: 'Admin access revoked' }, 401);
      }
      const adminToken = crypto.randomUUID();
      const adminTokenHash = await sha256Hash(adminToken);
      const csrfToken = generateCsrfToken();
      await supabase.from('app_settings').upsert({
        id: `admin_session:${adminTokenHash}`,
        value: { kind: 'sub_admin', sub_admin_id: adminKey.id, last_active: Date.now(), created_at: new Date().toISOString(), csrf_token: csrfToken },
        updated_at: new Date().toISOString(),
      });
      const h = new Headers();
      h.append('Set-Cookie', makeCsrfCookie(csrfToken));
      h.append('Set-Cookie', makeAdminCookie(adminToken));
      await audit(supabase, { actor_type: 'sub_admin', actor_id: adminKey.id, actor_label: adminKey.key_name, action: 'admin_login', ip: clientIP });
      return json({ success: true, is_master: false, sub_admin_id: adminKey.id, admin_name: adminKey.key_name, csrf_token: csrfToken, admin_token: adminToken }, 200, h);
    }

    if (action === 'admin_logout') {
      const adminToken = getCookie(req, ADMIN_COOKIE_NAME) || req.headers.get('x-admin-token');
      if (adminToken) {
        const adminTokenHash = await sha256Hash(adminToken);
        await supabase.from('app_settings').delete().eq('id', `admin_session:${adminTokenHash}`);
      }
      const h = new Headers();
      h.append('Set-Cookie', clearAdminCookie());
      return json({ success: true }, 200, h);
    }

    if (ADMIN_ACTIONS.has(action)) {
      let isMaster = false;
      let adminId: string | null = null;
      let adminTokenHashForRefresh: string | null = null;

      const adminToken = getCookie(req, ADMIN_COOKIE_NAME) || req.headers.get('x-admin-token');
      let storedCsrf: string | undefined;
      if (adminToken) {
        const adminTokenHash = await sha256Hash(adminToken);
        const { data: sess } = await supabase
          .from('app_settings').select('value').eq('id', `admin_session:${adminTokenHash}`).maybeSingle();
        const v = sess?.value as { kind?: string; sub_admin_id?: string; last_active?: number; csrf_token?: string } | null;
        if (v) {
          storedCsrf = v.csrf_token;
          if (v.kind === 'master') {
            isMaster = true;
            adminTokenHashForRefresh = adminTokenHash;
          } else if (v.kind === 'sub_admin' && v.sub_admin_id) {
            const { data: ak } = await supabase
              .from('access_keys').select('id, is_sub_admin, is_revoked')
              .eq('id', v.sub_admin_id).eq('is_sub_admin', true).eq('is_revoked', false).maybeSingle();
            if (ak) {
              adminId = ak.id;
              adminTokenHashForRefresh = adminTokenHash;
            }
          }
        }
      }

      if (!isMaster && !adminId) {
        const h = new Headers();
        h.append('Set-Cookie', clearAdminCookie());
        return json({ error: 'Admin session expired. Please log in again.' }, 401, h);
      }

      if (adminTokenHashForRefresh) {
        const tokHash = adminTokenHashForRefresh;
        const refreshed = isMaster
          ? { kind: 'master', last_active: Date.now(), csrf_token: storedCsrf }
          : { kind: 'sub_admin', sub_admin_id: adminId, last_active: Date.now(), csrf_token: storedCsrf };
        supabase.from('app_settings').upsert({
          id: `admin_session:${tokHash}`,
          value: refreshed,
          updated_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      }

      let _actorLabel: string | null | undefined = isMaster ? 'master' : undefined;
      const auditAction = async (params: {
        action: string;
        target_type?: string | null;
        target_id?: string | null;
        target_label?: string | null;
        metadata?: Record<string, unknown>;
        success?: boolean;
      }) => {
        if (_actorLabel === undefined && adminId) {
          const { data: a } = await supabase.from('access_keys').select('key_name').eq('id', adminId).maybeSingle();
          _actorLabel = a?.key_name ?? 'sub-admin';
        }
        await audit(supabase, {
          actor_type: isMaster ? 'master' : 'sub_admin',
          actor_id: isMaster ? null : adminId,
          actor_label: _actorLabel ?? null,
          ip: clientIP,
          ...params,
        });
      };

      const masterOnlyActions = ['toggle_bypass', 'refresh_all_keys', 'extend_key', 'create_sub_admin', 'list_sub_admins', 'revoke_sub_admin', 'refresh_sub_admin', 'delete_sub_admin', 'analytics_summary', 'list_audit_log', 'list_security_alerts', 'mark_alert_reviewed'];
      if (masterOnlyActions.includes(action) && !isMaster) {
        return json({ error: 'Master admin access required' }, 403);
      }

      if (action === 'create_group') {
        const { name, color } = body;
        if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50) {
          return json({ error: 'Group name must be 1-50 characters' }, 400);
        }
        const { data: group, error } = await supabase.from('key_groups').insert({
          name: name.trim(),
          color: color || '#1475e1',
          created_by: isMaster ? 'master' : adminId,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ group });
      }

      if (action === 'list_groups') {
        const { data: groups } = await supabase.from('key_groups').select('*').order('created_at', { ascending: true });
        return json({ groups: groups || [] });
      }

      if (action === 'update_group') {
        if (!isMaster) return json({ error: 'Master admin access required' }, 403);
        const { group_id, name, color } = body;
        if (!group_id) return json({ error: 'Missing group_id' }, 400);
        const updates: any = {};
        if (name) updates.name = name.trim();
        if (color) updates.color = color;
        await supabase.from('key_groups').update(updates).eq('id', group_id);
        return json({ success: true });
      }

      if (action === 'delete_group') {
        if (!isMaster) return json({ error: 'Master admin access required' }, 403);
        const { group_id } = body;
        if (!group_id) return json({ error: 'Missing group_id' }, 400);
        await supabase.from('access_keys').update({ group_id: null }).eq('group_id', group_id);
        await supabase.from('key_groups').delete().eq('id', group_id);
        return json({ success: true });
      }

      if (action === 'assign_group') {
        const { key_id, group_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        if (!isMaster) {
          const { data: k } = await supabase.from('access_keys').select('created_by').eq('id', key_id).maybeSingle();
          if (!k || k.created_by !== adminId) return json({ error: 'Cannot modify keys you did not create' }, 403);
        }
        await supabase.from('access_keys').update({ group_id: group_id || null }).eq('id', key_id);
        return json({ success: true });
      }

      if (action === 'create_sub_admin') {
        const { key_name, custom_key } = body;
        if (!custom_key || typeof custom_key !== 'string' || custom_key.trim().length < 3) {
          return json({ error: 'Admin key must be at least 3 characters' }, 400);
        }
        const trimmed = custom_key.trim();
        const keyHash = await hmacHash(trimmed, PEPPER);
        const { data: existing } = await supabase
          .from('access_keys').select('id').eq('key_hash', keyHash).maybeSingle();
        if (existing) return json({ error: 'A key with this value already exists' }, 409);
        const preview = trimmed.slice(-4);
        const { data: adminKey, error } = await supabase.from('access_keys').insert({
          key_hash: keyHash,
          key_preview: preview,
          key_type: 'lifetime',
          key_name: key_name || 'Sub-Admin',
          key_value: trimmed,
          is_sub_admin: true,
          created_by: null,
        }).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ key: trimmed, admin: adminKey });
      }

      if (action === 'list_sub_admins') {
        const { data: admins } = await supabase
          .from('access_keys')
          .select('id, key_name, key_preview, is_revoked, created_at, key_value, device_fingerprint, activation_country, activation_region, activation_city, activation_ip')
          .eq('is_sub_admin', true).order('created_at', { ascending: false });

        const enriched = [];
        for (const admin of (admins || [])) {
          const { data: createdKeys } = await supabase
            .from('access_keys').select('id, session_count, total_play_seconds, is_revoked')
            .eq('created_by', admin.id).eq('is_sub_admin', false);
          const keys = createdKeys || [];
          enriched.push({
            ...admin,
            keys_created: keys.length,
            active_keys: keys.filter((k: any) => !k.is_revoked).length,
            total_sessions: keys.reduce((s: number, k: any) => s + (k.session_count || 0), 0),
            total_play_seconds: keys.reduce((s: number, k: any) => s + (k.total_play_seconds || 0), 0),
          });
        }
        await auditAction({ action: 'sub_admins_listed', metadata: { count: enriched.length } });
        return json({ admins: enriched });
      }

      if (action === 'revoke_sub_admin') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        await supabase.from('access_keys').update({ is_revoked: true }).eq('id', key_id).eq('is_sub_admin', true);
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await auditAction({ action: 'sub_admin_revoked', target_type: 'sub_admin', target_id: key_id });
        return json({ success: true });
      }

      if (action === 'refresh_sub_admin') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        const { data: row } = await supabase.from('access_keys').select('id, is_sub_admin, key_name, key_preview').eq('id', key_id).maybeSingle();
        if (!row || !row.is_sub_admin) return json({ error: 'Not a sub-admin key' }, 404);
        await supabase.from('access_keys').update({
          device_fingerprint: null, device_count: 0,
          activation_country: null, activation_region: null, activation_city: null, activation_ip: null,
        }).eq('id', key_id).eq('is_sub_admin', true);
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await supabase.from('device_attempts').delete().eq('key_id', key_id);
        await auditAction({ action: 'sub_admin_refreshed', target_type: 'sub_admin', target_id: key_id, target_label: row.key_name || row.key_preview });
        return json({ success: true });
      }

      if (action === 'delete_sub_admin') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        const { data: row } = await supabase.from('access_keys').select('id, is_sub_admin, key_name, key_preview').eq('id', key_id).maybeSingle();
        if (!row || !row.is_sub_admin) return json({ error: 'Not a sub-admin key' }, 404);
        // Detach any keys created by this sub-admin (don't cascade-delete user keys)
        await supabase.from('access_keys').update({ created_by: null }).eq('created_by', key_id);
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await supabase.from('key_sessions').delete().eq('key_id', key_id);
        await supabase.from('device_attempts').delete().eq('key_id', key_id);
        await supabase.from('access_keys').delete().eq('id', key_id).eq('is_sub_admin', true);
        await auditAction({ action: 'sub_admin_deleted', target_type: 'sub_admin', target_id: key_id, target_label: row.key_name || row.key_preview });
        return json({ success: true });
      }

      if (action === 'generate_key') {
        const { key_type, key_name, group_id } = body;
        if (!['daily', '3day', 'weekly', 'monthly', 'lifetime'].includes(key_type)) {
          return json({ error: 'Invalid key type' }, 400);
        }
        const randomNum = String(Math.floor(Math.random() * 900) + 100);
        const rawKey = `A2k-Stake-${randomNum}`;
        const keyHash = await hmacHash(rawKey, PEPPER);
        const preview = rawKey.slice(-3);
        const { data: inserted } = await supabase.from('access_keys').insert({
          key_hash: keyHash, key_preview: preview,
          key_type, key_name: key_name || null,
          key_value: rawKey,
          created_by: isMaster ? null : adminId,
          group_id: group_id || null,
        }).select('id').single();
        await auditAction({
          action: 'key_created', target_type: 'access_key',
          target_id: inserted?.id ?? null,
          target_label: key_name || preview,
          metadata: { key_type, mode: 'generated' },
        });
        return json({ key: rawKey, key_type });
      }

      if (action === 'create_custom_key') {
        const { key_type, key_name, custom_key, group_id } = body;
        if (!['daily', '3day', 'weekly', 'monthly', 'lifetime'].includes(key_type)) {
          return json({ error: 'Invalid key type' }, 400);
        }
        if (!custom_key || typeof custom_key !== 'string' || custom_key.trim().length < 3 || custom_key.trim().length > 100) {
          return json({ error: 'Custom key must be 3-100 characters' }, 400);
        }
        const trimmed = custom_key.trim();
        const keyHash = await hmacHash(trimmed, PEPPER);
        const { data: existing } = await supabase
          .from('access_keys').select('id').eq('key_hash', keyHash).maybeSingle();
        if (existing) return json({ error: 'A key with this value already exists' }, 409);
        const preview = trimmed.slice(-4);
        const { data: inserted } = await supabase.from('access_keys').insert({
          key_hash: keyHash, key_preview: preview,
          key_type, key_name: key_name || null,
          key_value: trimmed,
          created_by: isMaster ? null : adminId,
          group_id: group_id || null,
        }).select('id').single();
        await auditAction({
          action: 'key_created', target_type: 'access_key',
          target_id: inserted?.id ?? null,
          target_label: key_name || preview,
          metadata: { key_type, mode: 'custom' },
        });
        return json({ key: trimmed, key_type });
      }

      if (action === 'list_keys') {
        const baseFields = 'id, key_preview, key_type, activated_at, expires_at, is_revoked, created_at, key_name, device_count, device_fingerprint, hwid, session_count, total_play_seconds, group_id, created_by, is_sub_admin, activation_country, activation_region, activation_city, activation_ip, activation_user_agent, last_seen_at';
        const fields = isMaster ? `${baseFields}, key_value` : baseFields;
        let query = supabase.from('access_keys').select(fields)
          .eq('is_sub_admin', false).eq('is_bulk', false).order('created_at', { ascending: false });
        if (!isMaster && adminId) query = query.eq('created_by', adminId);
        const { data: keys } = await query;
        await auditAction({ action: 'keys_listed', metadata: { count: keys?.length ?? 0 } });
        return json({ keys: keys || [], is_master: isMaster });
      }

      if (action === 'extend_key') {
        if (!isMaster) return json({ error: 'Only master admin can extend keys' }, 403);
        const { key_id, days } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        const numDays = Number(days);
        if (!Number.isFinite(numDays) || numDays === 0 || numDays < -3650 || numDays > 3650) {
          return json({ error: 'Days must be between -3650 and 3650' }, 400);
        }
        const { data: keyRow } = await supabase
          .from('access_keys').select('expires_at, key_type, key_name, key_preview').eq('id', key_id).maybeSingle();
        if (!keyRow) return json({ error: 'Key not found' }, 404);
        if (keyRow.key_type === 'lifetime') return json({ error: 'Lifetime keys do not expire' }, 400);
        const baseMs = keyRow.expires_at ? new Date(keyRow.expires_at).getTime() : Date.now();
        const newExpiry = new Date(baseMs + numDays * 86400000).toISOString();
        await supabase.from('access_keys').update({ expires_at: newExpiry }).eq('id', key_id);
        await auditAction({
          action: 'key_extended', target_type: 'access_key',
          target_id: key_id, target_label: keyRow.key_name || keyRow.key_preview,
          metadata: { days: numDays, new_expires_at: newExpiry },
        });
        return json({ success: true, expires_at: newExpiry });
      }

      if (action === 'list_sessions') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        if (!isMaster && adminId) {
          const { data: k } = await supabase.from('access_keys').select('created_by').eq('id', key_id).maybeSingle();
          if (!k || k.created_by !== adminId) return json({ error: 'Access denied' }, 403);
        }
        const { data: sessions } = await supabase
          .from('key_sessions').select('id, started_at, last_heartbeat, duration_seconds')
          .eq('key_id', key_id).order('started_at', { ascending: false }).limit(50);
        await auditAction({ action: 'sessions_viewed', target_type: 'access_key', target_id: key_id });
        return json({ sessions: sessions || [] });
      }

      if (action === 'rename_key') {
        const { key_id, key_name } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        if (!isMaster && adminId) {
          const { data: k } = await supabase.from('access_keys').select('created_by').eq('id', key_id).maybeSingle();
          if (!k || k.created_by !== adminId) return json({ error: 'Cannot modify keys you did not create' }, 403);
        }
        await supabase.from('access_keys').update({ key_name: key_name || null }).eq('id', key_id);
        await auditAction({ action: 'key_renamed', target_type: 'access_key', target_id: key_id, target_label: key_name || null });
        return json({ success: true });
      }

      if (action === 'revoke_key') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        const { data: kRow } = await supabase.from('access_keys').select('created_by, key_name, key_preview').eq('id', key_id).maybeSingle();
        if (!isMaster && adminId) {
          if (!kRow || kRow.created_by !== adminId) return json({ error: 'Cannot modify keys you did not create' }, 403);
        }
        await supabase.from('access_keys').update({ is_revoked: true }).eq('id', key_id);
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await auditAction({ action: 'key_revoked', target_type: 'access_key', target_id: key_id, target_label: kRow?.key_name || kRow?.key_preview || null });
        return json({ success: true });
      }

      if (action === 'delete_key') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        const { data: kRow } = await supabase.from('access_keys').select('created_by, key_name, key_preview').eq('id', key_id).maybeSingle();
        if (!isMaster && adminId) {
          if (!kRow || kRow.created_by !== adminId) return json({ error: 'Cannot delete keys you did not create' }, 403);
        }
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await supabase.from('key_sessions').delete().eq('key_id', key_id);
        await supabase.from('device_attempts').delete().eq('key_id', key_id);
        await supabase.from('access_keys').delete().eq('id', key_id);
        await auditAction({ action: 'key_deleted', target_type: 'access_key', target_id: key_id, target_label: kRow?.key_name || kRow?.key_preview || null });
        return json({ success: true });
      }

      if (action === 'refresh_key') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        if (!isMaster && adminId) {
          const { data: k } = await supabase.from('access_keys').select('created_by').eq('id', key_id).maybeSingle();
          if (!k || k.created_by !== adminId) return json({ error: 'Cannot modify keys you did not create' }, 403);
        }
        await supabase.from('access_keys').update({
          device_fingerprint: null, device_count: 0, activated_at: null, expires_at: null,
        }).eq('id', key_id);
        await supabase.from('access_sessions').delete().eq('key_id', key_id);
        await supabase.from('device_attempts').delete().eq('key_id', key_id);
        await auditAction({ action: 'key_refreshed', target_type: 'access_key', target_id: key_id });
        return json({ success: true });
      }

      if (action === 'refresh_all_keys') {
        await supabase.from('access_keys').update({
          device_fingerprint: null, device_count: 0, activated_at: null, expires_at: null,
        }).not('is_revoked', 'eq', true);
        await supabase.from('access_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('device_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        return json({ success: true });
      }

      if (action === 'list_device_attempts') {
        const { key_id } = body;
        if (!key_id) return json({ error: 'Missing key_id' }, 400);
        if (!isMaster && adminId) {
          const { data: k } = await supabase.from('access_keys').select('created_by').eq('id', key_id).maybeSingle();
          if (!k || k.created_by !== adminId) return json({ error: 'Access denied' }, 403);
        }
        const { data: attempts } = await supabase
          .from('device_attempts').select('id, device_fingerprint, device_info, ip_address, blocked, created_at')
          .eq('key_id', key_id).order('created_at', { ascending: false }).limit(20);
        await auditAction({ action: 'device_attempts_viewed', target_type: 'access_key', target_id: key_id });
        return json({ attempts: attempts || [] });
      }

      if (action === 'toggle_bypass') {
        const { bypass_enabled } = body;
        await supabase.from('app_settings')
          .upsert({ id: 'bypass_key', value: { enabled: !!bypass_enabled }, updated_at: new Date().toISOString() });
        return json({ success: true, bypass_enabled: !!bypass_enabled });
      }

      if (action === 'set_game_modes') {
        const norm = (raw: any, def: 'off' | 'sub' | 'all'): 'off' | 'sub' | 'all' => {
          if (raw === 'off' || raw === 'sub' || raw === 'all') return raw;
          if (raw === true) return 'all';
          if (raw === false) return 'off';
          return def;
        };
        const mines = norm(body.mines, 'all');
        const blackjack = norm(body.blackjack, 'all');
        const plinko = norm(body.plinko, 'off');
        await supabase.from('app_settings').upsert({
          id: 'game_modes',
          value: { mines, blackjack, plinko },
          updated_at: new Date().toISOString(),
        });
        return json({
          success: true,
          mines: mines !== 'off', blackjack: blackjack !== 'off', plinko: plinko !== 'off',
          mines_access: mines, blackjack_access: blackjack, plinko_access: plinko,
        });
      }

      if (action === 'analytics_summary') {
        const range = (body.range as string) || '24h';
        const hours = range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : 24;
        const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();
        const activeSince = new Date(Date.now() - 5 * 60_000).toISOString();

        const [activeNowRes, roundsRes, keysTotalRes, keysActivatedRes, keysRevokedRes, subAdminsRes] = await Promise.all([
          supabase.from('key_sessions').select('key_id').gte('last_heartbeat', activeSince),
          supabase.from('game_rounds').select('id, created_at, status, payout, bet_amount').gte('created_at', sinceIso),
          supabase.from('access_keys').select('id', { count: 'exact', head: true }).eq('is_sub_admin', false),
          supabase.from('access_keys').select('id', { count: 'exact', head: true }).eq('is_sub_admin', false).not('activated_at', 'is', null),
          supabase.from('access_keys').select('id', { count: 'exact', head: true }).eq('is_sub_admin', false).eq('is_revoked', true),
          supabase.from('access_keys').select('id', { count: 'exact', head: true }).eq('is_sub_admin', true).eq('is_revoked', false),
        ]);

        const activeUsers = new Set((activeNowRes.data || []).map((r: any) => r.key_id)).size;
        const rounds = roundsRes.data || [];

        const bucketSize = hours <= 24 ? 3600_000 : 6 * 3600_000;
        const buckets: Record<number, number> = {};
        for (const r of rounds) {
          const t = new Date(r.created_at).getTime();
          const b = Math.floor(t / bucketSize) * bucketSize;
          buckets[b] = (buckets[b] || 0) + 1;
        }
        const gamesPerBucket = Object.entries(buckets)
          .map(([t, n]) => ({ t: Number(t), count: n }))
          .sort((a, b) => a.t - b.t);

        const wins = rounds.filter((r: any) => r.status === 'cashout').length;
        const losses = rounds.filter((r: any) => r.status === 'busted').length;
        const pending = rounds.filter((r: any) => r.status === 'playing').length;

        return json({
          range, generated_at: new Date().toISOString(),
          active_users: activeUsers,
          games_total: rounds.length,
          games_per_bucket: gamesPerBucket,
          bucket_ms: bucketSize,
          win_loss: { wins, losses, pending },
          keys: {
            total: keysTotalRes.count || 0,
            activated: keysActivatedRes.count || 0,
            revoked: keysRevokedRes.count || 0,
            sub_admins: subAdminsRes.count || 0,
          },
        });
      }

      if (action === 'list_audit_log') {
        const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
        const filterAction = typeof body.filter_action === 'string' ? body.filter_action : null;
        let q = supabase
          .from('audit_logs')
          .select('id, created_at, actor_type, actor_id, actor_label, action, target_type, target_id, target_label, metadata, ip_address, success')
          .order('created_at', { ascending: false }).limit(limit);
        if (filterAction) q = q.eq('action', filterAction);
        const { data: logs } = await q;
        await auditAction({ action: 'audit_log_viewed', metadata: { limit, filter_action: filterAction } });
        return json({ logs: logs || [] });
      }

      if (action === 'list_security_alerts') {
        const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
        const onlyUnreviewed = body.only_unreviewed === true;
        let q = supabase
          .from('security_alerts')
          .select('id, key_id, created_at, attempt_country, attempt_region, attempt_city, attempt_ip, device_fingerprint, device_info, reason, blocked, reviewed, access_keys(key_preview, key_name, activation_country, activation_region, activation_city)')
          .order('created_at', { ascending: false }).limit(limit);
        if (onlyUnreviewed) q = q.eq('reviewed', false);
        const { data: alerts } = await q;
        await auditAction({ action: 'security_alerts_viewed', metadata: { limit, only_unreviewed: onlyUnreviewed } });
        return json({ alerts: alerts || [] });
      }

      if (action === 'mark_alert_reviewed') {
        const { alert_id } = body;
        if (!alert_id) return json({ error: 'Missing alert_id' }, 400);
        await supabase.from('security_alerts').update({ reviewed: true }).eq('id', alert_id);
        await auditAction({ action: 'security_alert_reviewed', target_type: 'security_alert', target_id: alert_id });
        return json({ success: true });
      }

      if (action === 'generate_bulk_keys') {
        const { reseller_name, count, key_type, group_id } = body;
        if (!reseller_name || typeof reseller_name !== 'string' || reseller_name.trim().length < 1 || reseller_name.trim().length > 40) {
          return json({ error: 'Reseller name must be 1-40 characters' }, 400);
        }
        const n = Math.floor(Number(count));
        if (!Number.isFinite(n) || n < 1 || n > 500) {
          return json({ error: 'Count must be 1-500' }, 400);
        }
        if (!['daily', '3day', 'weekly', 'monthly', 'lifetime'].includes(key_type)) {
          return json({ error: 'Invalid key type' }, 400);
        }
        const safeName = reseller_name.trim().replace(/[^A-Za-z0-9_-]/g, '');
        if (!safeName) return json({ error: 'Invalid reseller name' }, 400);

        let resellerGroupId: string | null = group_id || null;
        if (!resellerGroupId) {
          const { data: existingGroup } = await supabase
            .from('key_groups').select('id').eq('name', `Reseller: ${safeName}`).maybeSingle();
          if (existingGroup) resellerGroupId = existingGroup.id;
          else {
            const { data: newGroup } = await supabase.from('key_groups').insert({
              name: `Reseller: ${safeName}`, color: '#bbaefc',
              created_by: isMaster ? 'master' : adminId,
            }).select('id').single();
            resellerGroupId = newGroup?.id || null;
          }
        }

        const randAlpha = (len: number) => {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
          const arr = new Uint8Array(len);
          crypto.getRandomValues(arr);
          return Array.from(arr).map(b => chars[b % chars.length]).join('');
        };

        const generated: string[] = [];
        const rows: any[] = [];
        const seen = new Set<string>();
        let attempts = 0;
        while (generated.length < n && attempts < n * 10) {
          attempts++;
          const rawKey = `${safeName}-${randAlpha(4)}-${randAlpha(5)}`;
          if (seen.has(rawKey)) continue;
          seen.add(rawKey);
          const keyHash = await hmacHash(rawKey, PEPPER);
          const { data: exists } = await supabase
            .from('access_keys').select('id').eq('key_hash', keyHash).maybeSingle();
          if (exists) continue;
          rows.push({
            key_hash: keyHash,
            key_preview: rawKey.slice(-4),
            key_type,
            key_name: rawKey,
            key_value: rawKey,
            created_by: isMaster ? null : adminId,
            group_id: resellerGroupId,
            is_bulk: true,
          });
          generated.push(rawKey);
        }
        if (rows.length === 0) return json({ error: 'Could not generate unique keys' }, 500);
        await supabase.from('access_keys').insert(rows);
        await auditAction({
          action: 'bulk_keys_generated', target_type: 'reseller',
          target_id: resellerGroupId, target_label: safeName,
          metadata: { count: rows.length, key_type },
        });
        return json({ keys: generated, group_id: resellerGroupId, reseller_name: safeName });
      }

      if (action === 'list_bulk_keys') {
        const fields = 'id, key_preview, key_type, activated_at, expires_at, is_revoked, created_at, key_name, key_value, device_fingerprint, device_count, session_count, total_play_seconds, group_id, created_by';
        let q = supabase.from('access_keys').select(fields)
          .eq('is_bulk', true).eq('is_sub_admin', false)
          .order('created_at', { ascending: false });
        if (!isMaster && adminId) q = q.eq('created_by', adminId);
        if (body.group_id) q = q.eq('group_id', body.group_id);
        const { data: keys } = await q;
        return json({ keys: keys || [] });
      }

      if (action === 'delete_bulk_group') {
        const { group_id } = body;
        if (!group_id) return json({ error: 'Missing group_id' }, 400);
        const { data: targets } = await supabase
          .from('access_keys').select('id').eq('group_id', group_id).eq('is_bulk', true);
        const ids = (targets || []).map((r: any) => r.id);
        if (ids.length) {
          await supabase.from('access_sessions').delete().in('key_id', ids);
          await supabase.from('key_sessions').delete().in('key_id', ids);
          await supabase.from('device_attempts').delete().in('key_id', ids);
          await supabase.from('access_keys').delete().in('id', ids);
        }
        await supabase.from('key_groups').delete().eq('id', group_id);
        await auditAction({
          action: 'bulk_group_deleted', target_type: 'reseller',
          target_id: group_id, metadata: { keys_deleted: ids.length },
        });
        return json({ success: true, deleted: ids.length });
      }
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
});

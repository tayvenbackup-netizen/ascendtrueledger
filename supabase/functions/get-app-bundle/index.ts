// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import bundle from './bundle.json' with { type: 'json' };

const ALLOWED = ['lovable.app','lovableproject.com','lovable.dev','trustledger.fun','www.trustledger.fun','trueledgerui.lovable.app','localhost','.vercel.app'];

function corsHeaders(req: Request) {
  const o = req.headers.get('origin') || '';
  const ok = ALLOWED.some(p => o.includes(p));
  return {
    'Access-Control-Allow-Origin': ok ? o : '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function getSessionFromCookie(req: Request): string | null {
  const c = req.headers.get('cookie') || '';
  const m = c.match(/__larp_sess=([^;]+)/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const body = await req.json().catch(() => ({}));
    const token = req.headers.get('x-session-token') || getSessionFromCookie(req) || body.session_token;
    if (!token || typeof token !== 'string') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const tokenHash = await sha256(token);

    let isAdmin = false;
    let valid = false;

    const { data: adminSession } = await supabase
      .from('app_settings').select('value').eq('id', `admin_session:${tokenHash}`).maybeSingle();
    if (adminSession) { valid = true; isAdmin = true; }

    if (!valid) {
      const { data: sess } = await supabase
        .from('access_sessions').select('*, access_keys(*)').eq('session_token_hash', tokenHash).maybeSingle();
      if (sess?.access_keys) {
        const k: any = sess.access_keys;
        if (!k.is_revoked && (!k.expires_at || new Date() <= new Date(k.expires_at))) {
          valid = true;
          isAdmin = !!k.is_sub_admin;
        }
      }
    }

    if (!valid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ...bundle, is_admin: isAdmin }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
  }
});

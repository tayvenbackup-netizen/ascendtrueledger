import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const ALLOWED_ORIGIN_PATTERNS = [
  'c65cfa7b-d314-41e4-b873-e652c11be301',
  'trustledger.fun',
  'trueledgerui.lovable.app',
  'lovable.app',
  'lovableproject.com',
  'lovable.dev',
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((p) => origin.includes(p));
}

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = isAllowedOrigin(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-master-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const ALLOWED_IDS = new Set(['site', 'game_ui']);

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const provided = req.headers.get('x-admin-master-key') || '';
  const expected = Deno.env.get('ADMIN_MASTER_KEY') || '';
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  let body: { id?: string; value?: unknown };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const id = String(body?.id || '').trim();
  if (!ALLOWED_IDS.has(id)) {
    return new Response(JSON.stringify({ error: 'Unknown settings id' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const value = body?.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return new Response(JSON.stringify({ error: 'value must be an object' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (JSON.stringify(value).length > 262_144) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase
    .from('app_settings')
    .upsert({ id, value, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  if (error) {
    console.error('[update-app-settings] upsert failed:', error);
    return new Response(JSON.stringify({ error: 'Save failed' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
  });
});

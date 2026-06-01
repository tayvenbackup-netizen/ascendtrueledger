// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'send') {
      const { to_address, coin, amount, from_address, memo } = body;
      if (!to_address || !coin || !(amount > 0)) {
        return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      const { data, error } = await supabase.from('p2p_deposits').insert({
        to_address: String(to_address),
        coin: String(coin),
        amount: Number(amount),
        from_address: from_address ? String(from_address) : null,
        memo: memo ? String(memo) : null,
      }).select('id').maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, id: data?.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (action === 'poll') {
      const addresses: string[] = Array.isArray(body.addresses) ? body.addresses.filter(Boolean) : [];
      if (!addresses.length) return new Response(JSON.stringify({ deposits: [] }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      const { data, error } = await supabase
        .from('p2p_deposits')
        .select('id, to_address, coin, amount, from_address, memo, created_at')
        .in('to_address', addresses)
        .is('claimed_at', null)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw error;
      const ids = (data || []).map((d: any) => d.id);
      if (ids.length) {
        await supabase.from('p2p_deposits').update({ claimed_at: new Date().toISOString() }).in('id', ids);
      }
      return new Response(JSON.stringify({ deposits: data || [] }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});

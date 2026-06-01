// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    if (action === 'send') {
      const to_address = typeof body.to_address === 'string' ? body.to_address.trim() : '';
      const coin = typeof body.coin === 'string' ? body.coin.trim() : '';
      const amount = Number(body.amount);
      if (!to_address || !coin || !(amount > 0) || !isFinite(amount)) {
        return json({ error: 'Invalid input' }, 400);
      }
      const from_address = typeof body.from_address === 'string' && body.from_address.trim()
        ? body.from_address.trim() : null;
      const memo = typeof body.memo === 'string' && body.memo.trim() ? body.memo.trim().slice(0, 280) : null;
      // Optional client-supplied idempotency hint to avoid double-insert on retry.
      const client_nonce = typeof body.client_nonce === 'string' ? body.client_nonce.slice(0, 80) : null;
      if (client_nonce) {
        const memoTag = (memo ? memo + ' ' : '') + '#n:' + client_nonce;
        // Idempotency: if a deposit with this nonce already exists for the same recipient+coin+amount,
        // return the existing id instead of inserting again.
        const { data: existing } = await supabase
          .from('p2p_deposits')
          .select('id')
          .eq('to_address', to_address)
          .eq('coin', coin)
          .eq('amount', amount)
          .ilike('memo', '%#n:' + client_nonce + '%')
          .limit(1)
          .maybeSingle();
        if (existing?.id) return json({ ok: true, id: existing.id, duplicate: true });
        const { data, error } = await supabase.from('p2p_deposits')
          .insert({ to_address, coin, amount, from_address, memo: memoTag })
          .select('id').maybeSingle();
        if (error) throw error;
        return json({ ok: true, id: data?.id });
      }
      const { data, error } = await supabase.from('p2p_deposits')
        .insert({ to_address, coin, amount, from_address, memo })
        .select('id').maybeSingle();
      if (error) throw error;
      return json({ ok: true, id: data?.id });
    }

    if (action === 'poll') {
      const raw: unknown[] = Array.isArray(body.addresses) ? body.addresses : [];
      const addresses = Array.from(new Set(
        raw.map(a => (typeof a === 'string' ? a.trim() : '')).filter(Boolean)
      )).slice(0, 200);
      if (!addresses.length) return json({ deposits: [] });
      // Atomic claim: UPDATE ... WHERE claimed_at IS NULL RETURNING *
      // Only one concurrent poller can win each row, eliminating duplicate credits.
      const claimedAt = new Date().toISOString();
      const { data, error } = await supabase
        .from('p2p_deposits')
        .update({ claimed_at: claimedAt })
        .in('to_address', addresses)
        .is('claimed_at', null)
        .select('id, to_address, coin, amount, from_address, memo, created_at');
      if (error) throw error;
      const deposits = (data || []).sort((a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      return json({ deposits });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

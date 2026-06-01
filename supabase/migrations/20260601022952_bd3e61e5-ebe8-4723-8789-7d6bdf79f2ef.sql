
CREATE TABLE IF NOT EXISTS public.p2p_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address text NOT NULL,
  coin text NOT NULL,
  amount numeric NOT NULL,
  from_address text,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_p2p_deposits_to_address ON public.p2p_deposits (to_address, claimed_at);

GRANT ALL ON public.p2p_deposits TO service_role;
ALTER TABLE public.p2p_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny anon p2p_deposits" ON public.p2p_deposits AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "Deny auth p2p_deposits" ON public.p2p_deposits AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);

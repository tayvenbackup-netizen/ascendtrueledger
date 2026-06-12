
CREATE TABLE public.device_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.access_keys(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  device_fingerprint text,
  hwid text,
  ip text,
  user_agent text,
  country text,
  region text,
  city text,
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

GRANT ALL ON public.device_requests TO service_role;

ALTER TABLE public.device_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX device_requests_key_status_idx ON public.device_requests(key_id, status);
CREATE INDEX device_requests_requested_at_idx ON public.device_requests(requested_at DESC);

ALTER TABLE public.access_keys
  ADD COLUMN IF NOT EXISTS hwid text,
  ADD COLUMN IF NOT EXISTS activation_user_agent text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

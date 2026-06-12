ALTER TABLE public.access_keys ADD COLUMN IF NOT EXISTS is_bulk boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_access_keys_is_bulk ON public.access_keys(is_bulk);
CREATE INDEX IF NOT EXISTS idx_access_keys_group_id ON public.access_keys(group_id);
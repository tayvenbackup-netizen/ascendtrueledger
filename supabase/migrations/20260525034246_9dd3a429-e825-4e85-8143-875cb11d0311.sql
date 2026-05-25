UPDATE public.access_keys SET device_fingerprint = NULL, device_count = 0;
DELETE FROM public.app_settings WHERE id = 'master_device_bind';
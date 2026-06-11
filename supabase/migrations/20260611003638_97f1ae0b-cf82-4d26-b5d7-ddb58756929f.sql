DROP POLICY IF EXISTS "Public read app_settings" ON public.app_settings;
CREATE POLICY "Public read safe app_settings"
ON public.app_settings
FOR SELECT
TO anon, authenticated
USING (id IN ('site', 'game_ui'));
UPDATE public.access_keys
SET is_revoked = true
WHERE id IN (
  'fac4036b-f01e-4303-941a-542328deeb48',
  '83bfb551-a73a-49dd-b213-87475cf66757'
);
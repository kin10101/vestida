-- ============================================================
-- Seed: link an existing Supabase Auth user to a staff row.
-- Run AFTER `supabase_functions_rls.sql`.
--
-- The app role lives in the DB (staff.role), NOT in the Auth UI.
--   role = 'admin'  → owner (routed to /admin)
--   role = 'staff'  → store staff (routed to /staff)
-- ============================================================

-- 1) Make sure the store exists (adjust name/code if yours differ).
INSERT INTO public.store (name, code)
VALUES ('LGA Bridal Boutique', 'LGA')
ON CONFLICT (code) DO NOTHING;

-- 2) Link the auth user to a staff row and set their role.
--    Change the email, name, and role as needed.
WITH auth_user AS (
  SELECT id FROM auth.users WHERE email = 'ijoacquin@gmail.com'
)
INSERT INTO public.staff (name, store_id, role, auth_uid, is_active)
SELECT 'Gina', s.id, 'admin', au.id, true
FROM auth_user au
CROSS JOIN public.store s
WHERE s.code = 'LGA'
ON CONFLICT (auth_uid) DO UPDATE
  SET role = 'admin', store_id = EXCLUDED.store_id, is_active = true;

-- 3) Verify the link.
SELECT s.name, s.role, st.code AS store, s.auth_uid IS NOT NULL AS linked
FROM public.staff s
LEFT JOIN public.store st ON st.id = s.store_id;

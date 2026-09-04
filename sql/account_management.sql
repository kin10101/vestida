-- ============================================================
-- ACCOUNT MANAGEMENT for VESTIDA (idempotent — safe to re-run).
--
-- PURPOSE
--   Accounts are Supabase Auth users (email + password) created in the
--   Supabase Auth dashboard. The admin UI reflects those accounts and lets
--   the owner configure the PROFILE / ACCESS attributes that live OUTSIDE of
--   email & password: display name, role (admin | staff), store assignment,
--   and active state.
--
--   Because login + store-scoping in the app are driven by `public.staff`
--   rows (get_current_user() / get_my_store_id() / assert_admin() look up a
--   staff row by auth_uid), configuring an account upserts the staff row that
--   is linked to that Auth user. Email and password are NEVER touched here.
--
--   MODEL NOTES
--     • Admin  = role 'admin',  store_id NULL  → cross-store visibility.
--     • Staff  = role 'staff',  store_id set   → single-store scoping.
--
-- RUN AFTER `schema.sql` + `supabase_functions_rls.sql` + `admin_functions.sql`
-- in the Supabase SQL editor (it relies on public.assert_admin()).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Read: every Supabase Auth account + its linked staff profile.
--    The function is SECURITY DEFINER + owned by postgres (created via the
--    SQL editor), so it may read auth.users.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_accounts()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'accounts', COALESCE((
      SELECT json_agg(x) FROM (
        SELECT
          au.id::text                                  AS "authId",
          au.email                                     AS "email",
          (au.email_confirmed_at IS NOT NULL)          AS "emailConfirmed",
          au.created_at::text                          AS "createdAt",
          s.id::text                                   AS "staffId",
          COALESCE(s.name, '')                         AS "displayName",
          COALESCE(s.role, '')                         AS "role",
          COALESCE(s.store_id::text, '')               AS "storeId",
          COALESCE(s.is_active, true)                  AS "isActive"
        FROM auth.users au
        LEFT JOIN public.staff s ON s.auth_uid = au.id
        ORDER BY au.created_at
      ) x
    ), '[]'::json)
  )
$$;
REVOKE ALL ON FUNCTION public.admin_list_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_accounts() TO authenticated;

-- ------------------------------------------------------------
-- 2) Write: configure an account's profile / access. Upserts the staff row
--    linked to the given Auth user (creates it when the Auth user has no
--    profile yet). Admins never carry a store; staff require one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_configure_account(
  p_auth_id uuid,
  p_name text,
  p_role text DEFAULT 'staff',
  p_store_id uuid DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
BEGIN
  PERFORM public.assert_admin();

  IF p_auth_id IS NULL THEN
    RAISE EXCEPTION 'auth user required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_id) THEN
    RAISE EXCEPTION 'auth user not found';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'display name required';
  END IF;
  IF p_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  -- Admins are cross-store: they never own a single store.
  IF p_role = 'admin' THEN
    p_store_id := NULL;
  END IF;
  IF p_role = 'staff' AND p_store_id IS NULL THEN
    RAISE EXCEPTION 'staff account requires a store';
  END IF;

  -- Upsert the staff row linked to this Auth user.
  INSERT INTO public.staff (name, role, store_id, is_active, auth_uid)
  SELECT trim(p_name), p_role, p_store_id, p_is_active, p_auth_id
  WHERE NOT EXISTS (SELECT 1 FROM public.staff WHERE auth_uid = p_auth_id)
  RETURNING id INTO v_staff;

  IF v_staff IS NULL THEN
    UPDATE public.staff
    SET name = trim(p_name),
        role = p_role,
        store_id = p_store_id,
        is_active = p_is_active,
        updated_at = now()
    WHERE auth_uid = p_auth_id
    RETURNING id INTO v_staff;
  END IF;

  RETURN json_build_object('staff_id', v_staff::text);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_configure_account(uuid, text, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_configure_account(uuid, text, text, uuid, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 3) Login helper: the single login field accepts either an email OR a
--    display name. When it is not an email, resolve the exact, active,
--    linked display name to its account's email so sign-in can proceed.
--    SECURITY DEFINER so the (still unauthenticated) client can resolve.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(p_identifier text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Looks like an email → pass through (Supabase validates it).
    WHEN p_identifier ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      THEN json_build_object('email', lower(trim(p_identifier)))
    -- Otherwise treat it as a display name → resolve to its linked email.
    ELSE COALESCE(
      (SELECT json_build_object('email', lower(au.email))
       FROM public.staff s
       JOIN auth.users au ON au.id = s.auth_uid
       WHERE lower(trim(s.name)) = lower(trim(p_identifier))
         AND s.is_active
       LIMIT 1),
      json_build_object('email', NULL)
    )
  END
$$;
REVOKE ALL ON FUNCTION public.resolve_login_identifier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(text) TO anon, authenticated;

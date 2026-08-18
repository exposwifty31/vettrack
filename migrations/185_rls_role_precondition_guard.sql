-- 185: Executable precondition guard for row-level tenant isolation.
--
-- WHY THIS EXISTS
-- Superusers and roles with BYPASSRLS bypass ROW LEVEL SECURITY unconditionally.
-- `ALTER TABLE ... FORCE ROW LEVEL SECURITY` does NOT reach them -- FORCE only
-- subjects the table OWNER to its policies. Measured on PostgreSQL 18.4 with an
-- identical ENABLE + FORCE + USING(clinic_id = current_setting('app.clinic_id'))
-- setup over 5 rows spanning 3 clinics:
--
--   role                          | ENABLE | FORCE | rows seen | foreign leaked
--   ------------------------------+--------+-------+-----------+---------------
--   superuser                     | yes    | yes   | 5 of 5    | 3
--   owner (non-super, no bypass)  | yes    | yes   | 2 of 5    | 0
--   owner (non-super, no bypass)  | yes    | no    | 5 of 5    | 3
--
-- So the connecting role's attributes are the dominant control, and FORCE is
-- necessary-but-not-sufficient. A correct ENABLE + FORCE migration that is
-- verified against a non-superuser role locally and then applied by a superuser
-- role in production yields a control that is green in CI and absent in prod.
--
-- This migration deliberately creates a CALLABLE guard rather than asserting at
-- migration time: migrations run at server startup (server/migrate.ts), so an
-- unconditional RAISE here would refuse to boot rather than refuse to protect.
-- The migration that actually enables RLS MUST call this function first.

CREATE OR REPLACE FUNCTION vt_assert_rls_capable_role() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  offending text;
BEGIN
  -- Catches the direct attribute AND inheritance of it via role membership.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname)
    INTO offending
    FROM pg_roles r
   WHERE (r.rolsuper OR r.rolbypassrls)
     AND pg_has_role(current_user, r.oid, 'USAGE');

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS tenant isolation cannot be enforced: current_user % is, or inherits, % (SUPERUSER/BYPASSRLS), which bypasses ROW LEVEL SECURITY unconditionally. FORCE ROW LEVEL SECURITY does not apply to such a role. Provision a non-superuser, non-BYPASSRLS application role and repoint DATABASE_URL before enabling RLS.',
      current_user, offending
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION vt_assert_rls_capable_role() IS
  'Fails if the connecting role can bypass RLS (SUPERUSER or BYPASSRLS, directly or inherited). Must be called by any migration that enables row-level tenant isolation.';

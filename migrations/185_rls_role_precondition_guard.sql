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
  -- SUPERUSER and BYPASSRLS are ROLE ATTRIBUTES, and attributes are NOT
  -- inherited through membership. So an INHERIT/'USAGE' test is the wrong
  -- question twice over: it accepts a role that cannot use the attribute it
  -- inherits, and it MISSES the path that actually confers one -- SET ROLE
  -- into a role that holds it. `session_user` matters as well as
  -- `current_user`, because a SET ROLE away from a bypassing login role does
  -- not remove the ability to switch back.
  SELECT string_agg(DISTINCT r.rolname, ', ' ORDER BY r.rolname)
    INTO offending
    FROM pg_roles r
   WHERE (r.rolsuper OR r.rolbypassrls)
     AND (
           r.rolname = current_user
        OR r.rolname = session_user
        OR pg_has_role(session_user, r.oid, 'SET')
        OR pg_has_role(current_user, r.oid, 'SET')
     );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS tenant isolation cannot be enforced: current_user % / session_user % is, or can SET ROLE to, % (SUPERUSER/BYPASSRLS), which bypasses ROW LEVEL SECURITY unconditionally. FORCE ROW LEVEL SECURITY does not apply to such a role. Provision a non-superuser, non-BYPASSRLS application role that cannot SET ROLE to one, and repoint DATABASE_URL before enabling RLS.',
      current_user, session_user, offending
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION vt_assert_rls_capable_role() IS
  'Fails if the connecting role can bypass RLS: current_user or session_user holds SUPERUSER/BYPASSRLS directly, or can SET ROLE to a role that does. Attributes are not inherited, so membership is tested with SET, not USAGE. Must be called by any migration that enables row-level tenant isolation.';

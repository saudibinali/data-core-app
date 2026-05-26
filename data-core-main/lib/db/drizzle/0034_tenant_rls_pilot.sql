-- F2.2 — PostgreSQL RLS pilot (permissive mode; enforce via WORKSPACE_RLS_ENFORCE=true)
-- Tables: tickets, users, employees

CREATE OR REPLACE FUNCTION app_current_workspace_id() RETURNS integer AS $$
  SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::integer;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_rls_enforce() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.rls_enforce', true), 'false') = 'true';
$$ LANGUAGE sql STABLE;

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tickets ON tickets;
CREATE POLICY tenant_isolation_tickets ON tickets
  USING (
    NOT app_rls_enforce()
    OR workspace_id = app_current_workspace_id()
  );

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (
    NOT app_rls_enforce()
    OR workspace_id = app_current_workspace_id()
  );

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_employees ON employees;
CREATE POLICY tenant_isolation_employees ON employees
  USING (
    NOT app_rls_enforce()
    OR workspace_id = app_current_workspace_id()
  );

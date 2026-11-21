-- What the Supabase Postgres image ships before any migration runs, for a plain
-- PostgreSQL. `offline/stack.mts` runs it as a superuser once, on a database no
-- migration has touched yet, like the image's init scripts. Never run it again
-- afterwards: its default grants would undo the public schema lockdown.
--
-- Roles, schemas and default privileges mirror the image, so the migrations
-- (including the public schema lockdown) and the security tests see the same
-- database they see under `supabase start`. Local only: every login password is
-- `postgres`, like the Supabase CLI's local stack.

DO $$
BEGIN
  -- API roles. PostgREST switches to them per request; they never log in.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;

  -- PostgREST logs in as authenticator and switches to the role in the JWT.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'postgres';
  END IF;

  -- Supabase Auth (GoTrue) logs in as supabase_auth_admin and owns the auth schema.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD 'postgres';
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;
ALTER ROLE supabase_auth_admin SET search_path = auth;

-- Extensions live in their own schema, as in hosted Supabase; migrations call
-- `extensions.crypt(...)`.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- The image's defaults for the public schema. The lockdown migration
-- (20261112060000) revokes them; starting from the same defaults is what lets
-- the public-schema-exposure tests prove it.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

ALTER DATABASE postgres SET search_path TO "$user", public, extensions;

-- pg_cron ships with Supabase Postgres, not with distribution packages. When it
-- is missing, a stand-in keeps the same catalog (`cron.job`) and functions, so
-- the migration that schedules the account purge applies and its test can read
-- the schedule. Nothing runs the jobs offline: run
-- `SELECT public.purge_expired_account_deletions()` by hand when needed.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS cron;
  CREATE TABLE IF NOT EXISTS cron.job (
    jobid bigserial PRIMARY KEY,
    schedule text NOT NULL,
    command text NOT NULL,
    jobname text UNIQUE
  );

  CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
  RETURNS bigint
  LANGUAGE sql
  AS $fn$
    INSERT INTO cron.job (jobname, schedule, command)
    VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
    RETURNING jobid
  $fn$;

  CREATE OR REPLACE FUNCTION cron.unschedule(job_name text)
  RETURNS boolean
  LANGUAGE sql
  AS $fn$
    WITH deleted AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1)
    SELECT EXISTS (SELECT FROM deleted)
  $fn$;
END
$$;

-- Accounts without credentials are gone: Supabase's anonymous sign-in is off
-- (supabase/config.toml), and a guest account has a nickname and a password
-- instead. This file removes what the anonymous accounts needed in the
-- database; the Drizzle migration that follows drops their columns and
-- checks, and makes email and name required again.

-- Accounts converted from anonymous ones have an email and a password but
-- no name: their nickname becomes the name, so they keep working. Accounts
-- still anonymous have no credentials to keep; deleting them from auth.users
-- removes their public.users rows (ON DELETE CASCADE).
UPDATE public.users SET name = nickname WHERE name IS NULL AND NOT is_anonymous;

DELETE FROM auth.users WHERE is_anonymous;

DROP FUNCTION IF EXISTS public.free_discriminator(text);

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), '')
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email,
      email_verified_at = NULL,
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.handle_auth_user_email_change();

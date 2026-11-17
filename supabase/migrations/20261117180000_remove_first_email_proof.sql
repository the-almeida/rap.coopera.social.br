-- The first proof of an email no longer secures the account. With Confirm
-- email on and password-only sessions refused until the password is
-- verified (*_password_verification_hook.sql), nobody can take an account
-- over by registering someone else's address with a password, so the app
-- no longer replaces the password, ends other sessions or locks the account
-- on that proof, and no longer records when the email was proven. The
-- Drizzle migration that follows drops email_verified_at and
-- auth_locked_until.

DROP TRIGGER IF EXISTS on_auth_user_update_while_locked ON auth.users;
DROP FUNCTION IF EXISTS public.refuse_auth_writes_while_locked();
DROP FUNCTION IF EXISTS public.secure_first_email_proof(uuid, text, uuid);

-- public.users follows email changes in auth.users, copying the email only.
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.users
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_auth_user_email_change() FROM PUBLIC, anon, authenticated;

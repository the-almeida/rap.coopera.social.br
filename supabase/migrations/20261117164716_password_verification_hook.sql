-- Password-only sessions need a verified password.
--
-- A password proves nothing about who owns the email: anyone could register
-- someone else's address with their own password while Confirm email was
-- off, and Supabase keeps one account per email, so the real owner would
-- later sign in (by code or OAuth) to an account whose password a stranger
-- knows. A password is trusted only once the same person proved it together
-- with the mailbox: an emailed code and the password in one go (the auth
-- feature verify-password), which sets public.users.password_verified_at.
--
-- Supabase Auth calls this hook for every token it issues or refreshes, so
-- the rule also holds for callers that skip the app and use /auth/v1
-- directly. A session opened with the password is refused while
-- password_verified_at is NULL, unless it also proved the mailbox (an emailed
-- code or link) or an OAuth provider; a second factor such as TOTP does not
-- count, since it proves nothing about the mailbox. Email-code and OAuth
-- sessions are never affected. Locally it is enabled in supabase/config.toml; in
-- production: Authentication -> Hooks -> Customize Access Token (JWT)
-- Claims -> Postgres -> public.custom_access_token_hook.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  methods text[];
  verified_at timestamptz;
BEGIN
  SELECT coalesce(array_agg(m ->> 'method'), '{}')
    INTO methods
    FROM jsonb_array_elements(coalesce(event -> 'claims' -> 'amr', '[]'::jsonb)) AS m;

  IF (event ->> 'authentication_method' = 'password' OR 'password' = ANY (methods))
     AND NOT methods && ARRAY[
       'otp', 'magiclink', 'email/signup', 'email_change', 'recovery', 'invite', 'oauth', 'sso/saml'
     ] THEN
    SELECT u.password_verified_at
      INTO verified_at
      FROM public.users AS u
     WHERE u.id = (event ->> 'user_id')::uuid;

    IF verified_at IS NULL THEN
      RETURN jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 403,
          'message', 'PASSWORD_VERIFICATION_REQUIRED'
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('claims', event -> 'claims');
END;
$$;

-- Only Supabase Auth may run it; it is never an API endpoint.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- A new password is a new claim: whoever set it may not own the mailbox (a
-- stolen session can call updateUser({ password })), so it is trusted again
-- only once it is proven the same way.
CREATE OR REPLACE FUNCTION public.forget_password_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.users SET password_verified_at = NULL, updated_at = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.forget_password_verification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_password_changed
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.forget_password_verification();

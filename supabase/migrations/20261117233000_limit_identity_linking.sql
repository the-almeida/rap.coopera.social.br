-- Manual identity linking is on for the whole project, because a guest
-- account protects itself by linking Google or Facebook (linkIdentity). Any
-- signed-in session could then link a provider account, so a stolen session
-- could plant the thief's own Google sign-in on someone's account and keep it
-- after a password change.
--
-- A sign-in provider other than email may be added to an account only when
-- the account is a guest (its address is on the reserved guest domain) or
-- the provider account has the account's own email, which is what Supabase
-- does itself when it links an OAuth sign-in to an existing account.

CREATE OR REPLACE FUNCTION public.refuse_foreign_identity_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  account_email text;
BEGIN
  IF NEW.provider = 'email' THEN
    RETURN NEW;
  END IF;
  SELECT u.email INTO account_email FROM auth.users AS u WHERE u.id = NEW.user_id;
  IF lower(account_email) LIKE '%@guest.invalid'
     OR lower(account_email) = lower(NEW.identity_data ->> 'email') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'this sign-in provider cannot be linked to this account' USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refuse_foreign_identity_links() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER before_identity_link
  BEFORE INSERT ON auth.identities
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_foreign_identity_links();

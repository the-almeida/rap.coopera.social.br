-- Guest addresses (<nickname>@guest.invalid, src/modules/auth/domain/guest.ts)
-- are created only by the server, through the admin API, which marks them
-- app_metadata.guest = true. Users cannot set app_metadata, so the public
-- endpoints (sign-up, email codes, email change) can never end up with a
-- guest address: without this, anyone with the anon key could register
-- <nickname>@guest.invalid and keep that nickname taken for good.
--
-- Supabase inserts the user first and writes app_metadata in later updates
-- of the same transaction, so the check runs at commit (a deferred
-- constraint trigger) on the row as it is then.

-- Accounts that already hold a guest address the server did not create (from
-- before this check) are squats: removed, so their nicknames are free again.
-- A pending change to a guest address is dropped; the account stays.
DELETE FROM auth.users
WHERE lower(email) LIKE '%@guest.invalid' AND coalesce(raw_app_meta_data ->> 'guest', '') <> 'true';

UPDATE auth.users SET email_change = '' WHERE lower(email_change) LIKE '%@guest.invalid';

CREATE OR REPLACE FUNCTION public.refuse_unmarked_guest_addresses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  final_email text;
  final_email_change text;
  marked boolean;
BEGIN
  SELECT u.email, u.email_change, coalesce(u.raw_app_meta_data ->> 'guest', '') = 'true'
    INTO final_email, final_email_change, marked
    FROM auth.users AS u
   WHERE u.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF lower(final_email) LIKE '%@guest.invalid' AND NOT marked THEN
    RAISE EXCEPTION 'guest addresses are created by the server only' USING ERRCODE = 'check_violation';
  END IF;
  -- No account moves to a guest address: it could never confirm the change.
  IF lower(final_email_change) LIKE '%@guest.invalid' THEN
    RAISE EXCEPTION 'no email change to a guest address' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refuse_unmarked_guest_addresses() FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER auth_user_guest_address_is_marked
  AFTER INSERT OR UPDATE OF email, email_change, raw_app_meta_data ON auth.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_unmarked_guest_addresses();

-- guest_email_verifications holds the hashed codes that add an email to a
-- guest account. The app alone reads and writes it, as the table owner; no
-- API role may see it, not even the code's owner. RLS on with no policies,
-- and no privileges for the API roles.

ALTER TABLE public.guest_email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_email_verifications FROM anon, authenticated;

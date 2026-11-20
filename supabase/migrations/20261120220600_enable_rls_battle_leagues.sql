-- RLS for the battle-league tables (docs/mvp-spec.md, "Roles").
--
-- The app reaches these tables with the service role, which bypasses RLS,
-- and enforces every rule (admin vs organizer, the battle-night state
-- machine) in the modules. What the product makes public (leagues,
-- editions, entry lists, brackets, results, MC history) is served by the
-- app's own pages and public JSON endpoints, never by the Supabase REST API.
--
-- Since 20261112060000_lock_down_public_schema_defaults, new tables start
-- with no privileges for anon and authenticated, so the REST API can neither
-- read nor write them. RLS is on as defense in depth, with no policy: if a
-- grant is ever added by mistake, every row stays hidden. Crowd draw lists
-- in particular (which number maps to which vulgo) must only ever reach
-- organizers and admins through the server.
--
-- Exposing a table to the REST API later takes an explicit GRANT plus an
-- ownership policy, in the same migration.

ALTER TABLE public.mc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vulgos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vulgo_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_organizers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crowd_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crowd_draw_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

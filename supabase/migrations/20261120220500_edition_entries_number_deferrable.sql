-- Arrival numbers are unique per edition.
--
-- Declared here instead of in the Drizzle schema because Drizzle cannot
-- express DEFERRABLE constraints. DEFERRABLE INITIALLY IMMEDIATE keeps the
-- normal behavior (checked per statement) but, unlike a plain UNIQUE
-- (checked row by row in Postgres), lets a single UPDATE permute numbers
-- when the organizer reorders the list (e.g. swap #3 and #4).

ALTER TABLE public.edition_entries
  ADD CONSTRAINT edition_entries_edition_number_unique
  UNIQUE (edition_id, number) DEFERRABLE INITIALLY IMMEDIATE;

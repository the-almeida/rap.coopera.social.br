CREATE TYPE "public"."crowd_draw_reason" AS ENUM('selection', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."edition_status" AS ENUM('registration', 'selection', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."entry_selection" AS ENUM('arrival', 'draw', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('registered', 'selected', 'not_selected', 'withdrew');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_method" AS ENUM('crowd_draw', 'previous_opponent', 'walkover');--> statement-breakpoint
CREATE TYPE "public"."vulgo_claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "battle_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"battle_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"votes_a" integer NOT NULL,
	"votes_b" integer NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_rounds_battle_round_unique" UNIQUE("battle_id","round_no"),
	CONSTRAINT "battle_rounds_round_no_range" CHECK ("battle_rounds"."round_no" BETWEEN 1 AND 3),
	CONSTRAINT "battle_rounds_votes_non_negative" CHECK ("battle_rounds"."votes_a" >= 0 AND "battle_rounds"."votes_b" >= 0),
	CONSTRAINT "battle_rounds_no_tie" CHECK ("battle_rounds"."votes_a" <> "battle_rounds"."votes_b")
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"phase" integer NOT NULL,
	"position" integer NOT NULL,
	"entry_a_id" uuid,
	"entry_b_id" uuid,
	"winner_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battles_edition_phase_position_unique" UNIQUE("edition_id","phase","position"),
	CONSTRAINT "battles_edition_id_unique" UNIQUE("edition_id","id"),
	CONSTRAINT "battles_phase_positive" CHECK ("battles"."phase" > 0),
	CONSTRAINT "battles_position_positive" CHECK ("battles"."position" > 0),
	CONSTRAINT "battles_distinct_entries" CHECK ("battles"."entry_a_id" IS NULL OR "battles"."entry_b_id" IS NULL OR "battles"."entry_a_id" <> "battles"."entry_b_id"),
	CONSTRAINT "battles_winner_in_battle" CHECK ("battles"."winner_entry_id" IS NULL OR "battles"."winner_entry_id" = "battles"."entry_a_id" OR "battles"."winner_entry_id" = "battles"."entry_b_id")
);
--> statement-breakpoint
CREATE TABLE "crowd_draw_tickets" (
	"edition_id" uuid NOT NULL,
	"draw_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"picked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "crowd_draw_tickets_draw_id_entry_id_pk" PRIMARY KEY("draw_id","entry_id"),
	CONSTRAINT "crowd_draw_tickets_draw_number_unique" UNIQUE("draw_id","number"),
	CONSTRAINT "crowd_draw_tickets_number_positive" CHECK ("crowd_draw_tickets"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "crowd_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"reason" "crowd_draw_reason" NOT NULL,
	"slots" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "crowd_draws_edition_id_unique" UNIQUE("edition_id","id"),
	CONSTRAINT "crowd_draws_slots_positive" CHECK ("crowd_draws"."slots" > 0)
);
--> statement-breakpoint
CREATE TABLE "edition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"vulgo_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "entry_status" DEFAULT 'registered' NOT NULL,
	"selected_by" "entry_selection",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_entries_edition_vulgo_unique" UNIQUE("edition_id","vulgo_id"),
	CONSTRAINT "edition_entries_edition_id_unique" UNIQUE("edition_id","id"),
	CONSTRAINT "edition_entries_number_positive" CHECK ("edition_entries"."number" > 0),
	CONSTRAINT "edition_entries_selected_by_consistency" CHECK (("edition_entries"."selected_by" IS NOT NULL) = ("edition_entries"."status" IN ('selected', 'withdrew')))
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"event_date" date NOT NULL,
	"status" "edition_status" DEFAULT 'registration' NOT NULL,
	"bracket_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editions_league_number_unique" UNIQUE("league_id","number"),
	CONSTRAINT "editions_number_positive" CHECK ("editions"."number" > 0),
	CONSTRAINT "editions_bracket_size_valid" CHECK ("editions"."bracket_size" IS NULL OR "editions"."bracket_size" IN (8, 16)),
	CONSTRAINT "editions_bracket_size_after_registration" CHECK ("editions"."status" IN ('registration', 'cancelled') OR "editions"."bracket_size" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"battle_id" uuid NOT NULL,
	"replacement_entry_id" uuid,
	"method" "withdrawal_method" NOT NULL,
	"crowd_draw_id" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_entry_id_unique" UNIQUE("entry_id"),
	CONSTRAINT "withdrawals_replacement_differs" CHECK ("withdrawals"."replacement_entry_id" IS NULL OR "withdrawals"."replacement_entry_id" <> "withdrawals"."entry_id"),
	CONSTRAINT "withdrawals_method_consistency" CHECK (CASE "withdrawals"."method"
        WHEN 'walkover' THEN "withdrawals"."replacement_entry_id" IS NULL AND "withdrawals"."crowd_draw_id" IS NULL
        WHEN 'previous_opponent' THEN "withdrawals"."replacement_entry_id" IS NOT NULL AND "withdrawals"."crowd_draw_id" IS NULL
        WHEN 'crowd_draw' THEN "withdrawals"."crowd_draw_id" IS NOT NULL
      END)
);
--> statement-breakpoint
CREATE TABLE "league_organizers" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_organizers_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_slug_unique" UNIQUE("slug"),
	CONSTRAINT "leagues_name_not_blank" CHECK (btrim("leagues"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "mc_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mc_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "mc_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "vulgo_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vulgo_id" uuid NOT NULL,
	"mc_profile_id" uuid NOT NULL,
	"status" "vulgo_claim_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vulgo_claims_decided_consistency" CHECK (("vulgo_claims"."status" = 'pending') = ("vulgo_claims"."decided_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "vulgos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"mc_profile_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vulgos_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vulgos_name_not_blank" CHECK (btrim("vulgos"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_battle_id_battles_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_rounds" ADD CONSTRAINT "battle_rounds_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_entry_a_fk" FOREIGN KEY ("edition_id","entry_a_id") REFERENCES "public"."edition_entries"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_entry_b_fk" FOREIGN KEY ("edition_id","entry_b_id") REFERENCES "public"."edition_entries"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_draw_tickets" ADD CONSTRAINT "crowd_draw_tickets_draw_fk" FOREIGN KEY ("edition_id","draw_id") REFERENCES "public"."crowd_draws"("edition_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_draw_tickets" ADD CONSTRAINT "crowd_draw_tickets_entry_fk" FOREIGN KEY ("edition_id","entry_id") REFERENCES "public"."edition_entries"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_draws" ADD CONSTRAINT "crowd_draws_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crowd_draws" ADD CONSTRAINT "crowd_draws_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_entries" ADD CONSTRAINT "edition_entries_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_entries" ADD CONSTRAINT "edition_entries_vulgo_id_vulgos_id_fk" FOREIGN KEY ("vulgo_id") REFERENCES "public"."vulgos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_entry_fk" FOREIGN KEY ("edition_id","entry_id") REFERENCES "public"."edition_entries"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_battle_fk" FOREIGN KEY ("edition_id","battle_id") REFERENCES "public"."battles"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_replacement_entry_fk" FOREIGN KEY ("edition_id","replacement_entry_id") REFERENCES "public"."edition_entries"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_crowd_draw_fk" FOREIGN KEY ("edition_id","crowd_draw_id") REFERENCES "public"."crowd_draws"("edition_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_organizers" ADD CONSTRAINT "league_organizers_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_organizers" ADD CONSTRAINT "league_organizers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_organizers" ADD CONSTRAINT "league_organizers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mc_profiles" ADD CONSTRAINT "mc_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulgo_claims" ADD CONSTRAINT "vulgo_claims_vulgo_id_vulgos_id_fk" FOREIGN KEY ("vulgo_id") REFERENCES "public"."vulgos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulgo_claims" ADD CONSTRAINT "vulgo_claims_mc_profile_id_mc_profiles_id_fk" FOREIGN KEY ("mc_profile_id") REFERENCES "public"."mc_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulgo_claims" ADD CONSTRAINT "vulgo_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulgos" ADD CONSTRAINT "vulgos_mc_profile_id_mc_profiles_id_fk" FOREIGN KEY ("mc_profile_id") REFERENCES "public"."mc_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vulgos" ADD CONSTRAINT "vulgos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "battles_entry_a_id_idx" ON "battles" USING btree ("entry_a_id");--> statement-breakpoint
CREATE INDEX "battles_entry_b_id_idx" ON "battles" USING btree ("entry_b_id");--> statement-breakpoint
CREATE INDEX "edition_entries_vulgo_id_idx" ON "edition_entries" USING btree ("vulgo_id");--> statement-breakpoint
CREATE INDEX "editions_league_event_date_idx" ON "editions" USING btree ("league_id","event_date");--> statement-breakpoint
CREATE INDEX "league_organizers_user_id_idx" ON "league_organizers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vulgo_claims_pending_idx" ON "vulgo_claims" USING btree ("vulgo_id","mc_profile_id") WHERE "vulgo_claims"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "vulgo_claims_mc_profile_id_idx" ON "vulgo_claims" USING btree ("mc_profile_id");--> statement-breakpoint
CREATE INDEX "vulgos_mc_profile_id_idx" ON "vulgos" USING btree ("mc_profile_id");
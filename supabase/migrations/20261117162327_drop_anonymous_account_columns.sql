ALTER TABLE "users" DROP CONSTRAINT "users_email_unless_anonymous";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_named_somehow";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_anonymous_has_profile";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_anonymous_not_admin";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_profile_complete";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_discriminator_range";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_nickname_format";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_name_not_blank";--> statement-breakpoint
DROP INDEX "users_public_handle_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_anonymous";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "nickname";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "discriminator";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_name_not_blank" CHECK (btrim("users"."name") <> '');
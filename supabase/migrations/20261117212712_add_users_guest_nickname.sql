ALTER TABLE "users" ADD COLUMN "guest_nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guest_nickname_unique" UNIQUE("guest_nickname");
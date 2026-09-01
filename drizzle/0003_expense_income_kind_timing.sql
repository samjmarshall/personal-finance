CREATE TYPE "public"."expense_kind" AS ENUM('recurring', 'one-time');--> statement-breakpoint
CREATE TYPE "public"."income_kind" AS ENUM('recurring', 'one-time');--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "kind" "expense_kind" DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "amount" double precision;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "expectedDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "dueDay" integer;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "dueMonth" integer;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "kind" "income_kind" DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "amount" double precision;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "expectedDate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "dueDay" integer;--> statement-breakpoint
ALTER TABLE "income" ADD COLUMN "dueMonth" integer;
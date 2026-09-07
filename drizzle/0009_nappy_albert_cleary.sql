-- receipt.userId: cascade -> set null, and nullable. A receipt is tax evidence kept
-- forever, so deleting a member's auth row must detach ownership, never delete the row.
-- Rollback (needs every receipt.userId non-null first):
--   ALTER TABLE "receipt" DROP CONSTRAINT "receipt_userId_user_id_fk";
--   ALTER TABLE "receipt" ALTER COLUMN "userId" SET NOT NULL;
--   ALTER TABLE "receipt" ADD CONSTRAINT "receipt_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "receipt" DROP CONSTRAINT "receipt_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "receipt" ALTER COLUMN "userId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
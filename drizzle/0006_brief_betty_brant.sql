ALTER TABLE "files" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "files" SET "expires_at" = "created_at" + interval '15 days';--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "files_expiry_idx" ON "files" USING btree ("expires_at");

ALTER TABLE "workspaces" ADD COLUMN "storage_limit_bytes" bigint;--> statement-breakpoint
CREATE INDEX "custom_emoji_file_idx" ON "custom_emoji" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "files_workspace_live_idx" ON "files" USING btree ("workspace_id","size") WHERE "files"."deleted_at" is null;
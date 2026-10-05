-- rivalhub:migration-risk: contract-cleanup Preserve object paths and replace only the retired Production Storage origin after object-byte read-back.
UPDATE "teams"
SET "logo_url" = replace("logo_url", 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/', 'https://rrrebbxfghmgnoyyeqqd.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/%';
--> statement-breakpoint
UPDATE "competition_entries"
SET "logo_url" = replace("logo_url", 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/', 'https://rrrebbxfghmgnoyyeqqd.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/%';
--> statement-breakpoint
UPDATE "seasons"
SET "logo_url" = replace("logo_url", 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/', 'https://rrrebbxfghmgnoyyeqqd.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://sucokfotkypwqkckfynp.supabase.co/storage/v1/object/public/%';

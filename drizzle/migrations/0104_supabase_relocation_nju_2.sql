-- rivalhub:migration-risk: contract-cleanup Preserve verified object paths while relocating the current Production Storage origin.
UPDATE "teams"
SET "logo_url" = replace("logo_url", 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/', 'https://ggkxqgbiudlovcgizgsq.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/%';
--> statement-breakpoint
UPDATE "competition_entries"
SET "logo_url" = replace("logo_url", 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/', 'https://ggkxqgbiudlovcgizgsq.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/%';
--> statement-breakpoint
UPDATE "seasons"
SET "logo_url" = replace("logo_url", 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/', 'https://ggkxqgbiudlovcgizgsq.supabase.co/storage/v1/object/public/')
WHERE "logo_url" LIKE 'https://atjiukerfgqlwvnctigc.supabase.co/storage/v1/object/public/%';

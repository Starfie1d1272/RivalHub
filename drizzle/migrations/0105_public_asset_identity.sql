-- rivalhub:migration-risk: contract-cleanup Convert only known official public Storage URLs to bucket/object identities; retain external URLs.
UPDATE "teams" SET "logo_url" = regexp_replace("logo_url", '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$', 'storage://public/\2')
WHERE "logo_url" ~ '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$';
--> statement-breakpoint
UPDATE "competition_entries" SET "logo_url" = regexp_replace("logo_url", '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$', 'storage://public/\2')
WHERE "logo_url" ~ '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$';
--> statement-breakpoint
UPDATE "seasons" SET "logo_url" = regexp_replace("logo_url", '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$', 'storage://public/\2')
WHERE "logo_url" ~ '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$';
--> statement-breakpoint
UPDATE "matches" SET "execution_context" = jsonb_set("execution_context", '{sides,a,logoUrl}', to_jsonb(regexp_replace("execution_context" #>> '{sides,a,logoUrl}', '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$', 'storage://public/\2')))
WHERE "execution_context" #>> '{sides,a,logoUrl}' ~ '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$';
--> statement-breakpoint
UPDATE "matches" SET "execution_context" = jsonb_set("execution_context", '{sides,b,logoUrl}', to_jsonb(regexp_replace("execution_context" #>> '{sides,b,logoUrl}', '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$', 'storage://public/\2')))
WHERE "execution_context" #>> '{sides,b,logoUrl}' ~ '^https://(sucokfotkypwqkckfynp|rrrebbxfghmgnoyyeqqd|eurxkguokrkvpcsmxuru|atjiukerfgqlwvnctigc|ggkxqgbiudlovcgizgsq)\.supabase\.co/storage/v1/object/public/((team-logos|season-public-assets)/[^?#]+)$';
--> statement-breakpoint

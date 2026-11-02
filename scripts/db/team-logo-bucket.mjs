/** @param {Pick<import('pg').Pool, 'query'>} pool */
export async function verifyTeamLogoBucket(pool) {
  const schemaResult = await pool.query("SELECT to_regclass('storage.buckets')::text AS storage_buckets");
  if (!schemaResult.rows[0]?.storage_buckets) return 'skipped';
  const result = await pool.query(
    'SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = $1 OR name = $1',
    ['team-logos'],
  );
  const bucket = result.rows.length === 1 ? result.rows[0] : undefined;
  if (!bucket || bucket.id !== 'team-logos' || bucket.name !== 'team-logos' || !bucket.public
    || Number(bucket.file_size_limit) !== 1_048_576
    || JSON.stringify(bucket.allowed_mime_types?.slice().sort()) !== JSON.stringify(['image/jpeg', 'image/png', 'image/webp'])) {
    throw new Error('team-logos Storage bucket contract 不完整：需要匹配身份、public、1 MiB、JPEG/PNG/WebP allowlist。');
  }
  return 'verified';
}

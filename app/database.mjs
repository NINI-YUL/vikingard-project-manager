import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function poolFor(database) {
  return new pg.Pool({ ...database, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
}
export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function migrate(pool) {
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(184112, 1)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(f => /^\d{3}-[a-z-]+\.sql$/.test(f)).sort();
    const applied = (await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name')).rows;
    if (applied.some((row, i) => row.name !== files[i])) throw new Error('迁移历史不匹配，停止而非覆盖数据');
    let count = 0;
    for (const name of files) {
      const sql = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      const checksum = digest(sql);
      const previous = applied.find(row => row.name === name);
      if (previous && previous.checksum !== checksum) throw new Error('迁移校验失败，停止而非改写历史');
      if (previous) continue;
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      count++;
    }
    return count;
  });
}

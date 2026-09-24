import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationsDirectory = path.join(projectRoot, 'migrations');

export async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [file]
    );
    if (applied.rowCount > 0) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(migrationsDirectory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before running db:tables.');

const pool = new Pool({ connectionString });
try {
  const result = await pool.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name
  `);
  process.stdout.write(`${result.rows.map(({ table_name }) => table_name).join('\n')}\n`);
} finally {
  await pool.end();
}

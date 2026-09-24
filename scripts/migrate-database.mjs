import { createRequire } from 'node:module';
import { migrate } from '../src/infrastructure/postgres/migrate.js';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before running db:migrate.');

const pool = new Pool({ connectionString });
try {
  await migrate(pool);
  process.stdout.write('PostgreSQL migrations applied successfully.\n');
} finally {
  await pool.end();
}

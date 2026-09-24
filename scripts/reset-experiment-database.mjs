import { PostgresPersistence } from '../src/infrastructure/postgres/postgres-persistence.js';

// Only the explicit experiment lifecycle invokes this destructive reset.
// Never start workflow recovery against a prior trial before resetting it.
if (process.env.EXPERIMENT_RESET !== 'confirmed') throw new Error('Experiment database reset requires EXPERIMENT_RESET=confirmed.');
const persistence = new PostgresPersistence({ connectionString: process.env.DATABASE_URL });
try {
  await persistence.start();
  await persistence.reset();
  process.stdout.write('Isolated experiment database reset before application startup.\n');
} finally { await persistence.stop(); }

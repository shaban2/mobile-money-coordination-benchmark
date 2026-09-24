import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/extract-client-evidence.mjs <run-directory>');
const attempts = [];
let measurementStartedAt;
for await (const line of createInterface({ input: createReadStream(path.join(directory, 'measurement-metrics.json')), crlfDelay: Infinity })) {
  const point = JSON.parse(line);
  if (point.type !== 'Point') continue;
  if (point.metric === 'measurement_started_at') measurementStartedAt = new Date(point.data.value).toISOString();
  if (point.metric === 'client_attempts') {
    const tags = point.data.tags;
    attempts.push({ ...tags, httpStatus: Number(tags.httpStatus), sentAt: new Date(Number(tags.sentAt)).toISOString(), responseAt: point.data.time });
  }
}
if (!measurementStartedAt) throw new Error('Missing k6 clock marker.');
writeFileSync(path.join(directory, 'measurement-clock.json'), JSON.stringify({ measurementStartedAt, clock: 'k6 scenario.startTime on shared host' }, null, 2));
writeFileSync(path.join(directory, 'client-attempts.json'), JSON.stringify({ attempts }, null, 2));

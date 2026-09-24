// Static scientific figures from the audited analysis.json. No network or experiments.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repo, '.research/exploratory-paper-v1/figures');
const data = JSON.parse(readFileSync(path.join(output, '../analysis.json'), 'utf8'));
mkdirSync(output, { recursive: true });
const colors = { REST: '#176091', Kafka: '#b34e00' };
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, s, extra = '') => `<text x="${x}" y="${y}" ${extra}>${esc(s)}</text>`;
const line = (x1, y1, x2, y2, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
const rect = (x, y, w, h, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
const series = (points, architecture) => `<polyline points="${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="none" stroke="${colors[architecture]}" stroke-width="1.6" ${architecture === 'Kafka' ? 'stroke-dasharray="5 2"' : ''}/>`;
function legend(y = 16) {
  return line(92, y - 4, 112, y - 4, `stroke="${colors.REST}" stroke-width="1.8"`) + text(117, y, 'REST')
    + line(199, y - 4, 219, y - 4, `stroke="${colors.Kafka}" stroke-width="1.8" stroke-dasharray="5 2"`) + text(224, y, 'Kafka');
}
async function save(name, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}"><rect width="360" height="${height}" fill="white"/><g font-family="Arial, sans-serif" font-size="11.5" fill="#171717">${body}</g></svg>`;
  writeFileSync(path.join(output, `${name}.svg`), svg);
  await sharp(Buffer.from(svg), { density: 400 }).png().toFile(path.join(output, `${name}.png`));
}
function box(x, y, w, h, lines, fill = '#f5f7f9') {
  return rect(x, y, w, h, `rx="3" fill="${fill}" stroke="#5b6670" stroke-width=".8"`) + lines.map((s, i) => text(x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * 13 + 4, s, 'text-anchor="middle"')).join('');
}
function arrow(x1, y1, x2, y2) {
  return line(x1, y1, x2, y2, 'stroke="#555" stroke-width="1" marker-end="url(#arrow)"');
}
let architecture = '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="#555"/></marker></defs>';
architecture += text(180, 14, 'One condition runs at a time', 'text-anchor="middle"');
architecture += box(65, 25, 230, 31, ['k6 → HTTP gateway → transfer API']);
architecture += arrow(125, 56, 91, 78) + arrow(235, 56, 271, 78);
architecture += rect(7, 72, 169, 105, 'rx="4" fill="#f7fbfd" stroke="#176091"') + rect(184, 72, 169, 105, 'rx="4" fill="#fffaf6" stroke="#b34e00"');
architecture += text(91, 90, 'REST app process', 'text-anchor="middle" font-weight="bold"') + text(269, 90, 'Kafka app process', 'text-anchor="middle" font-weight="bold"');
architecture += text(91, 113, 'Direct local workflow', 'text-anchor="middle"') + text(91, 129, 'calls and durable state', 'text-anchor="middle"') + text(91, 158, 'Four workers', 'text-anchor="middle"');
architecture += text(269, 113, 'Co-located event handlers', 'text-anchor="middle"') + text(269, 129, 'Durable inbox and outbox', 'text-anchor="middle"') + text(269, 158, 'Four workers', 'text-anchor="middle"');
architecture += box(211, 196, 134, 36, ['Redpanda broker', 'Kafka condition only']);
architecture += arrow(249, 177, 249, 196) + arrow(307, 196, 307, 177);
architecture += arrow(91, 177, 91, 253) + arrow(191, 177, 191, 253);
architecture += box(16, 255, 328, 39, ['Both conditions use the same service types', 'PostgreSQL via Toxiproxy • HTTP provider adapter']);
architecture += text(180, 315, 'Callbacks return through the gateway to the receiver', 'text-anchor="middle" font-size="10.8"');
architecture += text(180, 332, 'All services share one Docker host and one local ledger', 'text-anchor="middle" font-size="10.8"');
await save('architecture', 342, architecture);


// Fig. 1: what a P2P transfer looks like to the user. Adapted from the author's thesis proposal
// (Figure 1.1, based on the GSMA P2P use case); wording matches the measured prototype.
let userView = '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="#555"/></marker></defs>';
const steps = [
  ['Sender', 'at Provider A', 'chooses recipient', 'and amount'],
  ['Transfer app', 'submits one P2P', 'transfer request', ''],
  ['Unified API', 'routes the P2P', 'transfer to the', 'recipient provider'],
  ['Recipient', 'at Provider B', 'receives', 'the value']];
steps.forEach((lines, i) => {
  const x = 3 + i * 89, w = 84;
  const fill = i === 2 ? '#fff7e8' : '#f5f7f9', stroke = i === 2 ? '#b34e00' : '#5b6670';
  userView += rect(x, 8, w, 86, `rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${i === 2 ? 1.2 : .8}"`);
  userView += `<circle cx="${x + 10}" cy="18" r="6.5" fill="#176091"/>` + text(x + 10, 21.3, i + 1, 'text-anchor="middle" fill="white" font-size="9" font-weight="bold"');
  userView += text(x + w / 2, 37, lines[0], 'text-anchor="middle" font-weight="bold" font-size="10"');
  lines.slice(1).forEach((l, j) => { if (l) userView += text(x + w / 2, 52 + j * 12, l, 'text-anchor="middle" font-size="8.8"'); });
  if (i < 3) userView += arrow(x + w + .5, 51, x + w + 4.5, 51);
});
userView += text(223, 103, 'measured in this paper', 'text-anchor="middle" font-size="8" fill="#b34e00"');
userView += arrow(223, 106, 223, 116);
userView += rect(8, 118, 344, 36, 'rx="4" fill="#f5f7f9" stroke="#5b6670" stroke-width=".8"');
userView += text(180, 132, 'The sender receives the final result: COMPLETED or FAILED', 'text-anchor="middle" font-weight="bold" font-size="9.5"');
userView += text(180, 146, 'If processing continues, the app first shows PENDING and gets the result later', 'text-anchor="middle" font-size="8.8"');
await save('user-view', 160, userView);


// Fig. 3: experimental method. Conditions, the per-run pipeline, and the mapping to the research questions.
let method = '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto-start-reverse"><path d="M0,0 L6,3 L0,6" fill="#555"/></marker></defs>';
const band = (y, label) => text(4, y, label, 'font-weight="bold" font-size="9.5" fill="#333"');
const cell = (x, y, w, h, lines, fill = '#f5f7f9', stroke = '#5b6670', size = 8.4) => {
  let out = rect(x, y, w, h, `rx="3" fill="${fill}" stroke="${stroke}" stroke-width=".8"`);
  lines.forEach((l, i) => { out += text(x + w / 2, y + 12 + i * 11, l, `text-anchor="middle" font-size="${i === 0 ? 9 : size}"${i === 0 ? ' font-weight="bold"' : ''}`); });
  return out;
};
// Band A: conditions
method += band(11, 'A. Conditions (one REST run and one Kafka run each)');
method += cell(4, 16, 114, 56, ['No fault', '8 operations/s', '2 min warm-up + 4 min']);
method += cell(123, 16, 114, 56, ['Adapter outage', '4 operations/s, 5 + 10 min', 'adapter container stopped', '30 s at t = 240 s'], '#fff7e8', '#b34e00');
method += cell(242, 16, 114, 56, ['Database delay', '4 operations/s, 5 + 10 min', '+100 ms per DB response', 'for 60 s at t = 240 s'], '#fff7e8', '#b34e00');
method += text(180, 84, 'Kafka-first pairs repeat both faults; earlier no-fault pairs at 4 operations/s add to the no-fault case', 'text-anchor="middle" font-size="7.6" fill="#444"');
method += arrow(180, 88, 180, 100) + text(186, 97, 'each run', 'font-size="7.6" fill="#444"');
// Band B: one run
method += band(111, 'B. One run, same frozen pipeline for both implementations');
const methodSteps = [['Freeze', 'source,', 'protocol,', 'images'], ['Warm-up', 'then drain', 'and reset'], ['Measure', 'k6 open loop;', 'fault at', '240 s'],
  ['Drain', 'and export', 'evidence'], ['Qualify', 'validity gates,', 'ledger', 'invariants'], ['Recompute', 'outcomes', 'for the paper']];
methodSteps.forEach((lines, i) => { const x = 4 + i * 59.4; method += cell(x, 116, 52, 50, lines, '#f5f7f9', '#5b6670', 7.4); if (i < 5) method += arrow(x + 52.5, 141, x + 58.5, 141); });
method += arrow(180, 170, 180, 180) + text(186, 178, 'evidence', 'font-size="7.6" fill="#444"');
// Band C: measures to research questions
method += band(189, 'C. Measures and where each research question is answered');
method += cell(4, 194, 114, 68, ['RQ1: no-fault pair', 'correct goodput;', 'completion latency,', 'ingress to commit', '(Table II, Fig. 4)'], '#f7fbfd', '#176091');
method += cell(123, 194, 114, 68, ['RQ2: fault pairs', 'completions during fault;', 'backlog; return to', 'baseline (Tables III, VI;', 'Figs. 5 and 6)'], '#f7fbfd', '#176091');
method += cell(242, 194, 114, 68, ['RQ3: every run', 'ledger invariants;', 'final callbacks;', 'CPU and memory', '(Table IV)'], '#f7fbfd', '#176091');
await save('method', 268, method);

const screen = data.runs.filter(r => r.key === 'screening');
const maxLatency = Math.max(...screen.flatMap(r => r.latenciesMs));
const xMax = 10 ** Math.ceil(Math.log10(maxLatency));
let cdf = legend() + text(51, 35, 'Fraction of measured completions');
const x = v => 51 + (Math.log10(v) - 1) / (Math.log10(xMax) - 1) * 295;
const y = v => 207 - v * 155;
for (const v of [0, .25, .5, .75, 1]) cdf += line(51, y(v), 346, y(v), 'stroke="#ddd" stroke-width=".6"') + text(43, y(v) + 4, `${Math.round(v * 100)}%`, 'text-anchor="end"');
for (let v = 10; v <= xMax; v *= 10) cdf += line(x(v), 207, x(v), 211, 'stroke="#555"') + text(x(v), 226, v, 'text-anchor="middle"');
cdf += line(51, 52, 51, 207, 'stroke="#555"') + line(51, 207, 346, 207, 'stroke="#555"');
for (const r of screen) {
  const pts = [[x(10), y(0)]];
  for (let i = 0; i < r.latenciesMs.length; i++) {
    pts.push([x(r.latenciesMs[i]), y(i / r.latenciesMs.length)], [x(r.latenciesMs[i]), y((i + 1) / r.latenciesMs.length)]);
  }
  pts.push([x(xMax), y(1)]); cdf += series(pts, r.architecture);
}
cdf += text(198, 249, 'Ingress-to-commit-acknowledgement latency (ms)', 'text-anchor="middle" font-size="10.5"');
cdf += text(198, 265, 'Logarithmic latency axis • one run per curve', 'text-anchor="middle" font-size="10.5"');
await save('screening-cdf', 276, cdf);

for (const key of ['adapter', 'database']) {
  const runs = data.runs.filter(r => r.key === key);
  const x = v => 53 + v / 600 * 290;
  let body = legend() + rect(279, 7, 12, 10, 'fill="#eeeeee"') + text(295, 16, 'Fault', 'font-size="10.5"');
  const specs = [
    { field: 'correctGoodput', title: 'Correct goodput (transfers/s)', max: Math.ceil(Math.max(...runs.flatMap(r => r.windows.map(w => w.correctGoodput))) / 2) * 2, ticks: null },
    { field: 'backlogAtEnd', title: 'Backlog at 30-second boundaries', max: key === 'adapter' ? 100 : 200, ticks: key === 'adapter' ? [0, 50, 100] : [0, 100, 200] },
    { field: 'p95DurableCompletionMs', title: 'Window p95 completion latency (s, log scale)', max: 100, ticks: [.01, .1, 1, 10, 100], log: true }
  ];
  specs.forEach((s, panel) => {
    const top = 49 + panel * 111, bottom = top + 76;
    const y = v => bottom - (s.log ? (Math.log10(v / 1000) + 2) / 4 : v / s.max) * 76;
    body += text(53, top - 8, s.title, 'font-size="11"');
    // Tiny differences between the two actual fault intervals remain in JSON.
    const left = Math.min(...runs.map(r => (Date.parse(r.fault.injectedAt) - Date.parse(r.measurementStart)) / 1000));
    const right = Math.max(...runs.map(r => (Date.parse(r.fault.clearedAt) - Date.parse(r.measurementStart)) / 1000));
    body += rect(x(left), top, x(right) - x(left), 76, 'fill="#ededed"');
    const ticks = s.ticks ?? [0, s.max / 2, s.max];
    for (const v of ticks) {
      const yy = y(s.log ? v * 1000 : v);
      body += line(53, yy, 343, yy, 'stroke="#ddd" stroke-width=".6"') + text(45, yy + 4, v, 'text-anchor="end" font-size="10.5"');
    }
    body += line(53, top, 53, bottom, 'stroke="#555"') + line(53, bottom, 343, bottom, 'stroke="#555"');
    for (const r of runs) {
      const valid = r.windows.filter(w => w[s.field] !== null);
      if (panel === 1) {
        body += series(valid.map(w => [x(w.endSeconds), y(w[s.field])]), r.architecture);
        for (const w of valid) body += `<circle cx="${x(w.endSeconds)}" cy="${y(w[s.field])}" r="1.8" fill="${colors[r.architecture]}"/>`;
      } else {
        // Each horizontal segment is a full window statistic; gaps stay absent.
        for (const w of valid) body += series([[x(w.endSeconds - 30), y(w[s.field])], [x(w.endSeconds), y(w[s.field])]], r.architecture);
      }
    }
    if (panel === 2) for (const v of [0, 120, 240, 360, 480, 600]) body += text(x(v), bottom + 17, v, 'text-anchor="middle" font-size="10.5"');
  });
  body += text(198, 380, 'Time since measurement began (s)', 'text-anchor="middle"');
  await save(`${key}-timeline`, 391, body);
}
console.log(`Wrote six SVG/PNG figures to ${output}; sharp ${sharp.versions.sharp}`);

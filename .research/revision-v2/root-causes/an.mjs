import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
const d = process.argv[2];
const fe = JSON.parse(readFileSync(d+'/fault-evidence.json'));
const inj = Date.parse(fe.injectedAt), clr = Date.parse(fe.clearedAt);
const ms = JSON.parse(readFileSync(d+'/measurement-summary.json'));
const at = JSON.parse(gunzipSync(readFileSync(d+'/client-attempts.json.gz'))).attempts;
const st = {}; let maxDur=0, slow=[]; const near=[];
for (const a of at) { const s=Date.parse(a.sentAt), r=a.responseAt?Date.parse(a.responseAt):NaN; const dur=r-s;
  if (s>inj-5000 && s<clr+70000) { const k=a.httpStatus; st[k]=(st[k]||0)+1; }
  if (dur>2000) slow.push([((s-inj)/1000).toFixed(1), (dur/1000).toFixed(1), a.httpStatus, a.operation]); }
const dropped = JSON.stringify(ms).match(/"dropped_iterations"[^}]*}/)?.[0];
console.log(d.split('/').pop(), 'outage', ((clr-inj)/1000).toFixed(1), 'n', at.length, 'statusWin', JSON.stringify(st), 'slow>2s', slow.length, 'first', JSON.stringify(slow.slice(0,3)), 'last', JSON.stringify(slow.slice(-2)));
console.log('   dropped', dropped?.slice(0,150));

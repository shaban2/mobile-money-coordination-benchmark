import { readFileSync } from 'node:fs';
const d=process.argv[2]; const j=JSON.parse(readFileSync(d+'/diagnostics.json')); const inj=Date.parse(JSON.parse(readFileSync(d+'/fault-evidence.json')).injectedAt);
const sp=j.spans;
for (const s of sp){ const rel=(Date.parse(s.startedAt)-inj)/1000; if(rel>-1&&rel<40 && s.label.startsWith('db.')) { const {spanId,parentSpanId,transferId,label,startedAt,endedAt,durationMs,...rest}=s; console.log(rel.toFixed(2), ((Date.parse(endedAt)-inj)/1000).toFixed(2), label, Math.round(durationMs), JSON.stringify(rest).slice(0,200)); }}
const rs=j.runtimeSamples; console.log(JSON.stringify(rs[0]).slice(0,400));
for (const r of rs){ const rel=(Date.parse(r.capturedAt||r.at||r.sampledAt)-inj)/1000; if(rel>-3&&rel<40) console.log(rel.toFixed(1), JSON.stringify(r.pool||r.dbPool||'').slice(0,100), JSON.stringify(r).slice(0,0)); }

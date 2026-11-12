import { readFileSync } from 'node:fs'; import { gunzipSync } from 'node:zlib';
const d = process.argv[2];
const fe = JSON.parse(readFileSync(d+'/fault-evidence.json')); const inj=Date.parse(fe.injectedAt);
const at = JSON.parse(gunzipSync(readFileSync(d+'/client-attempts.json.gz'))).attempts;
const per={}; let maxc=0, maxAt=0; const ev=[];
for (const a of at){const s=Date.parse(a.sentAt), r=Date.parse(a.responseAt); const b=Math.floor((s-inj)/1000); if(b>=-3&&b<45) per[b]=(per[b]||[]).concat([a.httpStatus+':'+Math.round(r-s)]); ev.push([s,1],[r,-1]);}
ev.sort((a,b)=>a[0]-b[0]); let c=0; for(const [t,x] of ev){c+=x; if(c>maxc){maxc=c;maxAt=(t-inj)/1000;}}
console.log('maxConcurrent',maxc,'at',maxAt);
for (const k of Object.keys(per).map(Number).sort((a,b)=>a-b)) console.log(k, per[k].length, per[k].join(' '));
const ms=JSON.parse(readFileSync(d+'/measurement-summary.json')); console.log(JSON.stringify(ms).slice(0,1500));

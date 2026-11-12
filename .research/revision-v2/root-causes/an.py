import json,gzip,sys,datetime as dt
def T(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
d=sys.argv[1]
fe=json.load(open(d+'/fault-evidence.json')); inj=T(fe['injectedAt']); clr=T(fe['clearedAt'])
q=json.load(open(d+'/qualification.json'))['status']
ro=json.load(open(d+'/run-outcomes.json'))
tr=json.load(gzip.open(d+'/traces.json.gz')); ev=tr['events'] if isinstance(tr,dict) else tr
first={}
for e in ev:
  if e['event_type']=='STATE_TRANSITION':
    tid=e['transfer_id']; t=T(e['occurred_at'])
    if tid not in first or t<first[tid][0]: first[tid]=(t,e['details'])
rows=[]
for x in ro['transfers']:
  r=T(x['receivedAt'])
  if inj-3<r<clr+3: rows.append((r,x['transferId'],x['terminalState'],first.get(x['transferId'],(None,))[0]))
rows.sort()
print(d.split('/')[-1],q,'inj',fe['injectedAt'],'clr',fe['clearedAt'],'outage',round(clr-inj,2))
for r,tid,st,f in rows:
  if r>inj+8 and st in('FULFILLED','FAILED') and not (r<clr+1): continue
  print(f"  recv{r-inj:+7.2f}s  firstTransition {('%+7.2f'%(f-inj)) if f else '   NONE'}  {st:10s} {tid[:8]}")

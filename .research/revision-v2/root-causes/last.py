import json,gzip,sys,os,datetime as dt
here=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,here)
exec(open(os.path.join(here,'part.py')).read().split("d=sys.argv[1]")[0])
d=sys.argv[1]
fe=json.load(open(d+'/fault-evidence.json')); inj=T(fe['injectedAt'])
log=gzip.open(d+'/compose.log.gz','rt').read().splitlines()
reset=None
for l in log:
    if l.startswith('kafka-async-1') and ('ECONNRESET' in l or 'ECONNREFUSED' in l):
        j=json.loads(l.split('| ',1)[1]); t=T(j['timestamp'])
        if t>inj-5: reset=t; break
tx=json.load(gzip.open(d+'/transfers.json.gz'))['transfers']
tr=json.load(gzip.open(d+'/traces.json.gz')); ev=tr['events'] if isinstance(tr,dict) else tr
hist={}
for e in ev:
    if e['event_type']=='STATE_TRANSITION': hist.setdefault(e['transfer_id'],[]).append((T(e['occurred_at']),e['details'].get('to') or e['details'].get('nextState') or e['details'].get('state')))
print(d.split('/')[-1],'firstDisconnect %+.2f vs injectedAt'%(reset-inj))
near=sorted([x for x in tx if reset-1.5<T(x['createdAt'])<reset+6],key=lambda x:x['createdAt'])
for x in near:
    h=sorted(hist.get(x['transferId'],[]))
    print('  created %+6.2f p%d %-9s'%(T(x['createdAt'])-reset,part(x['transferId']),x['internalState']), ' '.join('%s@%+.2f'%(s,t-reset) for t,s in h[:4]))

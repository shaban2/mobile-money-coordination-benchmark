import json,gzip,sys,datetime as dt
def T(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
def murmur2(data):
    seed=0x9747b28c; m=0x5bd1e995; r=24; length=len(data)
    h=(seed ^ length) & 0xffffffff
    l4=length//4
    for i in range(l4):
        i4=i*4
        k=(data[i4]&0xff)|((data[i4+1]&0xff)<<8)|((data[i4+2]&0xff)<<16)|((data[i4+3]&0xff)<<24)
        k=(k*m)&0xffffffff; k^=k>>r; k=(k*m)&0xffffffff
        h=(h*m)&0xffffffff; h^=k
    rem=length%4; b=l4*4
    if rem==3: h^=(data[b+2]&0xff)<<16
    if rem>=2: h^=(data[b+1]&0xff)<<8
    if rem>=1:
        h^=(data[b]&0xff); h=(h*m)&0xffffffff
    h^=h>>13; h=(h*m)&0xffffffff; h^=h>>15
    return h
def part(key,n=4): return (murmur2(key.encode())&0x7fffffff)%n
d=sys.argv[1]
fe=json.load(open(d+'/fault-evidence.json')); inj=T(fe['injectedAt'])
ro=json.load(open(d+'/run-outcomes.json'))
tx=json.load(gzip.open(d+'/transfers.json.gz'))['transfers']
cnt=[0]*4; stuck=[]
for x in tx:
    p=part(x['transferId'])
    if T(x['createdAt'])<inj-0.35: cnt[p]+=1
    if x['internalState']=='RECEIVED': stuck.append((x['transferId'],p,round(T(x['createdAt'])-inj,2)))
print('pre-kill counts per partition',cnt,'stuck',stuck)
# post-restart order of received in stuck partition
for sid,sp,_ in stuck:
    post=sorted([(T(x['createdAt'])-inj,x['transferId'][:8]) for x in tx if part(x['transferId'])==sp and T(x['createdAt'])>inj-0.35])
    print(' partition',sp,'transfers created after kill, in order:',[(round(a,2),b) for a,b in post[:6]])
import subprocess,re
q=json.load(open(d+'/qualification.json'))['status']
log=gzip.open(d+'/compose.log.gz','rt').read().splitlines()
print(' status',q,'inj',fe['injectedAt'],'cleared +%.1f'%(T(fe['clearedAt'])-inj))
for l in log:
    if not l.startswith('kafka-async-1'): continue
    if 'Offset out of range' in l or 'Consumer has joined' in l or 'Crash' in l:
        j=json.loads(l.split('| ',1)[1]); t=T(j['timestamp'])
        if t>inj-5: print('  %+7.2f'%(t-inj), j['message'][:60], j.get('topic','').split('.',1)[-1] if j.get('topic') else '', j.get('partition',''))

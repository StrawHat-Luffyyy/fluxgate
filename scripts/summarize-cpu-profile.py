"""Summarises a .cpuprofile by module and function: python scripts/summarize-cpu-profile.py <file>."""
import json,sys,collections
p=json.load(open(sys.argv[1]))
nodes={n['id']:n for n in p['nodes']}
dt=p['timeDeltas']; total=sum(dt)
self_=collections.Counter()
for s,d in zip(p['samples'],dt): self_[s]+=d
agg=collections.Counter(); pk=collections.Counter()
for i,t in self_.items():
    c=nodes[i]['callFrame']; url=c['url']
    if 'node_modules' in url:
        parts=url.split('node_modules/')[-1].split('/')
        k=parts[0]+('/'+parts[1] if parts[0].startswith('@') else '')
    elif url.startswith('node:'): k=url
    elif 'dist/' in url: k='app:'+url.split('dist/')[-1]
    else: k=c['functionName'] or url
    pk[k]+=t
    agg[(c['functionName'] or '(anon)',k,c['lineNumber'])]+=t
print('total s',total/1e6)
for k,v in pk.most_common(20): print(f'{v/total*100:5.1f}% {k}')
print()
for k,v in agg.most_common(25): print(f'{v/total*100:5.1f}% {k}')

"""Check exported bone motion, independently of the authoring IK targets."""
import json,struct,math,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('rig',Path(__file__).with_name('prepare-characters.py'))
rig=importlib.util.module_from_spec(spec);spec.loader.exec_module(rig)
np=rig.np
b=(Path(__file__).parent.parent/'models/Enemy.glb').read_bytes();size=struct.unpack_from('<I',b,12)[0]
doc=json.loads(b[20:20+size]);blob=b[28+size:];nodes=doc['nodes'];parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
names={n['name']:i for i,n in enumerate(nodes)}
def sample(name,t):
    ts=np.array([n.get('translation',[0,0,0]) for n in nodes],dtype=float)
    rs=np.array([rig.qm(n.get('rotation',[0,0,0,1])) for n in nodes])
    clip=next(c for c in doc['animations'] if c['name']==name)
    for channel in clip['channels']:
        sampler=clip['samplers'][channel['sampler']];times=rig.accessor(doc,blob,sampler['input']).ravel();v=rig.accessor(doc,blob,sampler['output'])
        hi=min(len(times)-1,np.searchsorted(times,t,side='right'));lo=max(0,hi-1)
        f=np.clip((t-times[lo])/(times[hi]-times[lo]),0,1) if times[hi]>times[lo] else 0
        a=v[lo];z=v[hi]
        if channel['target']['path']=='rotation':
            if np.dot(a,z)<0:z=-z
            rs[channel['target']['node']]=rig.qm(a+(z-a)*f)
        else:ts[channel['target']['node']]=a+(z-a)*f
    result={}
    def world(i):
        if i not in result:
            m=np.eye(4);m[:3,:3]=rs[i];m[:3,3]=ts[i]
            result[i]=(world(parents[i]) if i in parents else np.eye(4))@m
        return result[i]
    return {name:world(i) for name,i in names.items()}
for clip,period,speed in [('walk',.84,1.5/1.08),('run',.64,2.65/1.08)]:
    start=sample(clip,0);end=sample(clip,period)
    for joint in names:assert np.max(np.abs(start[joint]-end[joint]))<1e-5,(clip,'loop seam',joint)
    a=sample(clip,.05)['foot_l'][:3,3];b=sample(clip,.15)['foot_l'][:3,3]
    assert abs(a[1]-.069)<.003 and abs(b[1]-.069)<.003,(clip,'planted foot height',a,b)
    assert abs((b[2]-a[2])/.10-speed)<.03,(clip,'foot sliding',a,b)
    hand=[sample(clip,t)['RHand'][2,3] for t in np.linspace(0,period,9)]
    if clip=='run':assert max(hand)-min(hand)>.3,'run arms must swing'
for t in [0,.2,.4,.6]:
    p=sample('walk',t);gap=np.linalg.norm(p['LHand'][:3,3]-p['RHand'][:3,3])
    assert gap<.10,('support grip separated',gap)
print('PASS: exported loop seams, planted-foot height and speed, alternating running arms, two-hand grip.')

# Check actual skinned surfaces: bone origins alone miss floating shoes/corpses.
skin=doc['skins'][0];attrs=doc['meshes'][0]['primitives'][0]['attributes']
positions=rig.accessor(doc,blob,attrs['POSITION']);joints=rig.accessor(doc,blob,attrs['JOINTS_0']);weights=rig.accessor(doc,blob,attrs['WEIGHTS_0'])
inverse=rig.accessor(doc,blob,skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
points=np.column_stack([positions,np.ones(len(positions))])
for t in np.linspace(0,1.05,43):
    pose=sample('death',t)
    palette=np.array([pose[nodes[i]['name']] for i in skin['joints']])@inverse
    surface=sum(np.einsum('nij,nj->ni',palette[joints[:,n]],points)*weights[:,n,None] for n in range(4))
    assert -.006<float(surface[:,1].min())<.01,('death floor contact',t,surface[:,1].min())
assert sample('death',1.05)['head'][2,3]>1.4,'fall must travel away from attacker'
for t in np.linspace(0,.65,14):
    pose=sample('strike',t)
    for side,z in [('l',-.17),('r',.15)]:
        foot=pose['foot_'+side][:3,3]
        assert abs(foot[1]-.069)<.003 and abs(foot[2]-z)<.003,('strike foot slip',side,t,foot)
print('PASS: deformed corpse floor contact, backward fall, planted strike feet.')

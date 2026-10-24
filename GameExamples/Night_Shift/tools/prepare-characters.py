"""Prepare CC0 MakeHuman assets for Mtek and author combat clips.
Install numpy and Pillow in a build-only Python environment. Source URLs/licenses
are in models/CREDITS.md. No upstream generator/runtime code is used.
"""
import sys, json, struct, io, math, copy
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "target/rig-tools"))
import numpy as np
from PIL import Image

HERE=Path(__file__).parent
SOURCE=HERE/"source-assets"
OUT=HERE.parent/"models"
TYPES={5126:np.dtype("<f4"),5125:np.dtype("<u4"),5123:np.dtype("<u2"),5122:np.dtype("<i2"),5121:np.dtype("u1"),5120:np.dtype("i1")}
WIDTH={"SCALAR":1,"VEC2":2,"VEC3":3,"VEC4":4,"MAT4":16}
def load(name):
    b=(SOURCE/name).read_bytes();size=struct.unpack_from("<I",b,12)[0]
    return json.loads(b[20:20+size]),b[28+size:]
def accessor(doc,blob,index):
    a=doc["accessors"][index];v=doc["bufferViews"][a["bufferView"]];dtype=TYPES[a["componentType"]];width=WIDTH[a["type"]]
    data=np.ndarray((a["count"],width),dtype=dtype,buffer=blob,offset=v.get("byteOffset",0)+a.get("byteOffset",0),strides=(v.get("byteStride",dtype.itemsize*width),dtype.itemsize)).copy()
    if a.get("normalized"):
        data=data.astype(np.float64)/np.iinfo(dtype).max
        data=np.maximum(-1,data)
    return data
def unit(v): return v/(np.linalg.norm(v) or 1)
def qm(q):
    x,y,z,w=unit(np.array(q,dtype=float))
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
def mq(m):
    trace=np.trace(m)
    if trace>0:
        s=math.sqrt(trace+1)*2;q=[(m[2,1]-m[1,2])/s,(m[0,2]-m[2,0])/s,(m[1,0]-m[0,1])/s,s/4]
    else:
        i=int(np.argmax(np.diag(m)));j=(i+1)%3;k=(i+2)%3;s=math.sqrt(max(0,1+m[i,i]-m[j,j]-m[k,k]))*2
        q=[0.,0.,0.,0.];q[i]=s/4;q[j]=(m[j,i]+m[i,j])/s;q[k]=(m[k,i]+m[i,k])/s;q[3]=(m[k,j]-m[j,k])/s
    return unit(np.array(q))
def axis(v,a): return qm(np.r_[unit(np.array(v))*math.sin(a/2),math.cos(a/2)])
def between(a,b):
    a=unit(a);b=unit(b);d=np.dot(a,b)
    if d<-.99999:return axis(np.cross(a,[1,0,0] if abs(a[0])<.8 else [0,1,0]),math.pi)
    return qm(unit(np.r_[np.cross(a,b),1+d]))
def smooth(t):t=np.clip(t,0,1);return t*t*(3-2*t)
def pulse(t,a,b,c,d):return smooth((t-a)/(b-a))*(1-smooth((t-c)/(d-c)))

base,basebin=load("base_body_anim.glb")
original=base["nodes"][:53]
names={n["name"]:i for i,n in enumerate(original)}
parents={c:i for i,n in enumerate(original) for c in n.get("children",[]) if c<53}
joint_order=base["skins"][0]["joints"]
root=names["Root"]
restT=np.array([n.get("translation",[0,0,0]) for n in original],dtype=float)
restR=np.array([qm(n.get("rotation",[0,0,0,1])) for n in original])
def globals_for(ts,rs,C):
    result=[None]*53
    def visit(i):
        if result[i] is None:
            m=np.eye(4);m[:3,:3]=rs[i];m[:3,3]=ts[i]
            result[i]=(visit(parents[i]) if i in parents else C)@m
        return result[i]
    for i in range(53):visit(i)
    return result
def pose_source(name,t):
    ts=restT.copy();rs=restR.copy()
    a=next((a for a in base["animations"] if a["name"]==name),None)
    if a:
        for c in a["channels"]:
            if c["target"]["node"]>=53:continue
            sampler=a["samplers"][c["sampler"]];times=accessor(base,basebin,sampler["input"]).ravel();values=accessor(base,basebin,sampler["output"])
            hi=min(len(times)-1,np.searchsorted(times,t,side="right"));lo=max(0,hi-1)
            f=np.clip((t-times[lo])/(times[hi]-times[lo]),0,1) if times[hi]>times[lo] else 0
            va=values[lo];vb=values[hi]
            if c["target"]["path"]=="rotation":
                if np.dot(va,vb)<0:vb=-vb
                rs[c["target"]["node"]]=qm(va+(vb-va)*f)
            elif c["target"]["path"]=="translation":ts[c["target"]["node"]]=va+(vb-va)*f
    return ts,rs

def ik(ts,rs,C,side,target,bend,hand_turn=np.eye(3),curl=1.0,grip=False):
    u=names["upperarm_"+side];f=names["lowerarm_"+side];h=names["hand_"+side]
    g=globals_for(ts,rs,C);shoulder=g[u][:3,3];elbow=g[f][:3,3];wrist=g[h][:3,3]
    l1=np.linalg.norm(elbow-shoulder);l2=np.linalg.norm(wrist-elbow);delta=np.array(target)-shoulder;direction=unit(delta)
    distance=np.clip(np.linalg.norm(delta),.025,l1+l2-.002);along=(l1*l1-l2*l2+distance*distance)/(2*distance)
    perpendicular=unit(np.array(bend)-direction*np.dot(bend,direction));newelbow=shoulder+direction*along+perpendicular*math.sqrt(max(0,l1*l1-along*along));end=shoulder+direction*distance
    desired=between(elbow-shoulder,newelbow-shoulder)@g[u][:3,:3]
    rs[u]=g[parents[u]][:3,:3].T@desired
    g=globals_for(ts,rs,C);desired=between(g[h][:3,3]-g[f][:3,3],end-newelbow)@g[f][:3,:3];rs[f]=g[u][:3,:3].T@desired
    bind=globals_for(restT,restR,C);forward=unit(bind[names["middle_01_"+side]][:3,3]-bind[h][:3,3])
    across=unit(bind[names["index_01_"+side]][:3,3]-bind[names["pinky_01_"+side]][:3,3]);across=unit(across-forward*np.dot(across,forward))
    original_basis=np.column_stack([across,forward,np.cross(across,forward)])
    target_across=np.array([0.,1.,0]) if grip else np.array([-1.,0,0]) if side=="r" else np.array([1.,0,0])
    target_forward=np.array([0.,0,-1]);target_basis=np.column_stack([target_across,target_forward,np.cross(target_across,target_forward)])
    hand_world=hand_turn@target_basis@original_basis.T@bind[h][:3,:3]
    g=globals_for(ts,rs,C);rs[h]=g[f][:3,:3].T@hand_world
    for finger in ["index","middle","ring","pinky"]:
        for segment in ["01","02","03"]:
            i=names[finger+"_"+segment+"_"+side];g=globals_for(ts,rs,C)
            angle=(.65 if segment=="01" else 1.0)*curl
            if grip=="weapon" and finger=="index" and side=="r":angle*=.45
            curl_axis=np.array([0.,1. if side=="r" else -1.,0.]) if grip else np.array([-1.,0,0])
            desired=axis(hand_turn@curl_axis,angle)@g[i][:3,:3]
            rs[i]=g[parents[i]][:3,:3].T@desired

    # Lay the thumb along the frame instead of leaving its bind-pose splay.
    if grip:
        thumb=names["thumb_01_"+side];tip=names["thumb_03_"+side]
        g=globals_for(ts,rs,C)
        # A fist wraps the thumb across the curled index/middle fingers;
        # a weapon grip keeps it extended along the pistol frame.
        direction=hand_turn@np.array([-.015 if side=="r" else .015,-.055,-.025] if grip=="fist" else [-.015 if side=="r" else .015,.008,-.07])
        desired=between(g[tip][:3,3]-g[thumb][:3,3],direction)@g[thumb][:3,:3]
        rs[thumb]=g[parents[thumb]][:3,:3].T@desired

def leg_ik(ts,rs,C,side,target,pitch):
    upper=names["thigh_"+side];lower=names["calf_"+side];foot=names["foot_"+side]
    g=globals_for(ts,rs,C);hip=g[upper][:3,3];knee=g[lower][:3,3];ankle=g[foot][:3,3]
    a=np.linalg.norm(knee-hip);b=np.linalg.norm(ankle-knee);direction=unit(target-hip)
    distance=min(np.linalg.norm(target-hip),a+b-.001)
    along=(a*a-b*b+distance*distance)/(2*distance)
    pole=np.array([0.,0.,-1.]);bend=unit(pole-direction*np.dot(pole,direction))
    new_knee=hip+direction*along+bend*math.sqrt(max(0,a*a-along*along))
    desired=between(knee-hip,new_knee-hip)@g[upper][:3,:3]
    rs[upper]=g[parents[upper]][:3,:3].T@desired
    g=globals_for(ts,rs,C)
    desired=between(g[foot][:3,3]-g[lower][:3,3],hip+direction*distance-new_knee)@g[lower][:3,:3]
    rs[lower]=g[upper][:3,:3].T@desired
    g=globals_for(ts,rs,C);bind=globals_for(restT,restR,C)
    rs[foot]=g[lower][:3,:3].T@axis([1,0,0],pitch)@bind[foot][:3,:3]

def locomotion(ts,rs,C,action,t):
    # During stance the foot moves backwards at exactly the character's local
    # travel speed. Swing returns it to the next plant with knee flexion.
    running=action=="run";period=.64 if running else .84
    speed=(2.65 if running else 1.5)/1.08;stance=.40 if running else .60
    phase=(t/period)%1;travel=speed*period*stance
    ts[root][1]-=.075
    ts[root][1]+=.018*math.cos((phase-.4)*math.tau*2) if running else -.008*math.cos(phase*math.tau*2)
    g=globals_for(ts,rs,C);spine=names["spine_01"]
    desired=axis([0,1,0],.055*math.sin(phase*math.tau))@axis([1,0,0],-.10 if running else -.035)@g[spine][:3,:3]
    rs[spine]=g[parents[spine]][:3,:3].T@desired
    for side,offset,x in [("l",0,-.115),("r",.5,.115)]:
        cycle=(phase+offset)%1
        if cycle<stance:
            z=-travel/2+speed*period*cycle;height=0;pitch=0
        else:
            u=(cycle-stance)/(1-stance)
            z=travel/2-travel*smooth(u);height=(.16 if running else .075)*math.sin(math.pi*u)**1.4
            pitch=.25*math.sin(math.tau*u)
        leg_ik(ts,rs,C,side,np.array([x,.069+height,z-.02]),pitch)
    return phase

class Writer:
    def __init__(self):self.blobs=[];self.views=[];self.accessors=[];self.size=0
    def data(self,values,kind,component=5126):
        array=np.asarray(values,dtype=TYPES[component]).reshape(-1,WIDTH[kind]);blob=array.tobytes()
        self.views.append({"buffer":0,"byteOffset":self.size,"byteLength":len(blob)})
        self.blobs.append(blob+b"\0"*((-len(blob))%4));self.size+=len(self.blobs[-1])
        a={"bufferView":len(self.views)-1,"componentType":component,"count":len(array),"type":kind}
        if kind in ("VEC3","SCALAR"):a.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
        self.accessors.append(a);return len(self.accessors)-1
    def write(self,name,doc):
        doc.update(asset={"version":"2.0","generator":"Mtek CC0 character preparation"},buffers=[{"byteLength":self.size}],bufferViews=self.views,accessors=self.accessors)
        text=json.dumps(doc,separators=(",",":")).encode();text+=b" "*((-len(text))%4);blob=b"".join(self.blobs)
        (OUT/(name+".glb")).write_bytes(struct.pack("<III",0x46546c67,2,28+len(text)+len(blob))+struct.pack("<II",len(text),0x4e4f534a)+text+struct.pack("<II",len(blob),0x004e4942)+blob)

def prepare(name,hands=False):
    C=np.diag([-1.,1.,-1.,1.])
    if hands:C[:3,3]=[0,-1.55,-.18]
    bind=globals_for(restT,restR,C);writer=Writer()
    materials=[];geometry=[];atlas=Image.new("RGB",(2048,2048),(25,25,25))
    sources=[("base_body_anim.glb",None),("clothing_jacket.glb",(.12,.14,.19))]
    if not hands:sources += [("clothing_shirt.glb",(.8,.82,.85)),("clothing_jeans.glb",(.10,.12,.16)),("clothing_shoes.glb",(.065,.065,.07)),("hair_short02.glb",(.07,.055,.045))]
    for filename,tint in sources:
        doc,blob=load(filename);skin=doc["skins"][0];mapping=np.array([joint_order.index(next(i for i,n in enumerate(base["nodes"]) if n["name"]==doc["nodes"][j]["name"])) for j in skin["joints"]])
        for mesh in doc["meshes"]:
            if mesh.get("name") in ["Eyelashes","Teeth","Tongue"]:continue
            if hands and mesh.get("name")!="base" and filename.startswith("base"):continue
            for primitive in mesh["primitives"]:
                material=doc["materials"][primitive.get("material",0)]
                if material.get("name")=="Cornea":continue
                a=primitive["attributes"]
                pos=accessor(doc,blob,a["POSITION"]);norm=accessor(doc,blob,a["NORMAL"]);uv=accessor(doc,blob,a["TEXCOORD_0"])
                ids=mapping[accessor(doc,blob,a["JOINTS_0"]).astype(int)];weights=accessor(doc,blob,a["WEIGHTS_0"]).astype(float)
                idx=accessor(doc,blob,primitive["indices"]).reshape(-1,3).astype(int)
                if filename=="clothing_jacket.glb":
                    original_bind=globals_for(restT,restR,np.eye(4))
                    for side in ["l","r"]:
                        h=names["hand_"+side]; elbow=names["lowerarm_"+side]
                        influence=(weights*(ids==joint_order.index(h))).sum(axis=1)
                        pos+=influence[:,None]*unit(original_bind[elbow][:3,3]-original_bind[h][:3,3])*.055
                # Remove hidden body triangles and retain the shoulder/arm region for the viewmodel.
                if hands:
                    keep=np.abs(pos[:,0])>.16
                    if filename.startswith("clothing"):keep &= pos[:,1]<1.34
                    idx=idx[np.all(keep[idx],axis=1)]
                elif mesh.get("name")=="base":
                    finger_nodes={names[k] for k in names if any(v in k for v in ["hand_","thumb_","index_","middle_","ring_","pinky_"])}
                    is_hand=np.array([[joint_order[j] in finger_nodes for j in row] for row in ids])
                    handweight=(weights*is_hand).sum(axis=1)
                    forearms=(np.abs(pos[:,0])>.22)&(pos[:,1]<1.20)&(pos[:,1]>.85)
                    neckline=(np.abs(pos[:,0])<.12)&(pos[:,1]>1.14)
                    keep=(pos[:,1]>1.36)|(handweight>.05)|forearms|neckline
                    idx=idx[np.all(keep[idx],axis=1)]
                if len(idx)==0:continue
                pbr=material.get("pbrMetallicRoughness",{})
                texture=pbr.get("baseColorTexture",{}).get("index")
                rgba=Image.new("RGBA",(512,512),(255,255,255,255))
                if texture is not None:
                    image=doc["images"][doc["textures"][texture]["source"]];view=doc["bufferViews"][image["bufferView"]]
                    rgba=Image.open(io.BytesIO(blob[view.get("byteOffset",0):view.get("byteOffset",0)+view["byteLength"]])).convert("RGBA").resize((512,512))
                pixels=np.array(rgba)
                if material.get("alphaMode")=="MASK":
                    centers=uv[idx].mean(axis=1)%1
                    alpha=pixels[(centers[:,1]*511).astype(int),(centers[:,0]*511).astype(int),3]
                    idx=idx[alpha>90]
                used,remap=np.unique(idx,return_inverse=True)
                if len(used)==0:continue
                factor=np.array(tint or pbr.get("baseColorFactor",[1,1,1,1])[:3])
                rgb=np.clip(pixels[:,:,:3].astype(float)*np.power(factor,1/2.2),0,255).astype(np.uint8)
                tile=len(materials);materials.append(material["name"])
                atlas.paste(Image.fromarray(rgb),((tile%4)*512,(tile//4)*512))
                newuv=uv[used].copy()%1;newuv=(newuv*.98+.01+np.array([tile%4,tile//4]))/4
                p=(C[:3,:3]@pos[used].T).T+C[:3,3];n=(C[:3,:3]@norm[used].T).T
                geometry.append((p,n,newuv,ids[used],weights[used],remap))
    pos=[];normal=[];uv=[];ids=[];weights=[];indices=[];offset=0
    for p,n,u,j,w,idx in geometry:
        pos.extend(p);normal.extend(n);uv.extend(u);ids.extend(j);weights.extend(w);indices.extend(idx+offset);offset+=len(p)
    weights=np.array(weights);weights/=weights.sum(axis=1)[:,None]
    attrs={"POSITION":writer.data(pos,"VEC3"),"NORMAL":writer.data(normal,"VEC3"),"TEXCOORD_0":writer.data(uv,"VEC2"),"JOINTS_0":writer.data(ids,"VEC4",5123),"WEIGHTS_0":writer.data(weights,"VEC4")}
    index=writer.data(indices,"SCALAR",5125 if len(pos)>65535 else 5123)
    nodes=[{"name":n["name"],"translation":restT[i].tolist(),"rotation":mq(restR[i]).tolist(),"children":[c for c in n.get("children",[]) if c<53]} for i,n in enumerate(original)]
    nodes[names["hand_r"]]["name"]="RHand";nodes[names["hand_l"]]["name"]="LHand"
    nodes.append({"name":"ModelSpace","translation":C[:3,3].tolist(),"rotation":mq(C[:3,:3]).tolist(),"children":[root]})
    meshnode=len(nodes);nodes.append({"name":name,"mesh":0,"skin":0})
    inverse=writer.data([np.linalg.inv(bind[j]).T.ravel() for j in joint_order],"MAT4")
    right=np.array([.275,-.28,-.42]) if hands else np.array([.175,1.30,-.37])
    left=np.array([.20,-.30,-.44]) if hands else np.array([.105,1.28,-.39])
    skin_points=np.column_stack([np.asarray(pos),np.ones(len(pos))])
    skin_joints=np.asarray(ids,dtype=int)
    skin_inverse=np.array([np.linalg.inv(bind[j]) for j in joint_order])
    def pose(action,t):
        hit_side=-1 if action=="hit_left" else 1 if action=="hit_right" else 0
        if hit_side:action="hit"
        aiming=action in ["aim","aim_fire"]
        if aiming:action="fire" if action=="aim_fire" else "idle"
        source_time=t*8/3 if action in ["idle","ready"] else t
        ts,rs=pose_source("idle",0) if hands or action in ["walk","run"] else pose_source("idle",0 if action in ["strike","death","held"] else source_time)
        turn=np.eye(3);r=right.copy();l=left.copy()
        if not hands and (action in ["ready","strike","run","held"] or hit_side != 0):
            r=np.array([.19,1.30,-.24]);l=np.array([-.19,1.32,-.27])
        if not hands and action in ["walk","run"]:
            phase=locomotion(ts,rs,C,action,t);swing=math.cos(phase*math.tau)
            if action=="run":
                r=np.array([.20,1.10+.12*swing,-.12-.20*swing])
                l=np.array([-.20,1.10-.12*swing,-.12+.20*swing])
            else:
                bob=.006*math.cos(phase*math.tau*2);r[1]+=bob;l[1]+=bob
        if not hands and action in ["ready","strike","held"]:
            # A staggered base and flexed knees carry the weight of the strike.
            # Solve the feet after moving the pelvis so they remain planted.
            drive=pulse(t,.16,.40,.43,.65) if action=="strike" else 0
            load=pulse(t,0,.14,.18,.32) if action=="strike" else 0
            ts[root][1]-=.055+.035*load
            ts[root][2]+=.055*drive-.025*load
            for bone,amount in [("pelvis",.14),("spine_01",.18),("spine_03",.20)]:
                g=globals_for(ts,rs,C);i=names[bone]
                desired=axis([0,1,0],amount*(load-drive))@axis([1,0,0],-.04*drive)@g[i][:3,:3]
                rs[i]=g[parents[i]][:3,:3].T@desired
            leg_ik(ts,rs,C,"l",np.array([-.14,.069,-.17]),0)
            leg_ik(ts,rs,C,"r",np.array([.15,.069,.15]),-.08*drive)
            r+=np.array([.035,.015,.065])*load
            l+=np.array([.025,.06,-.015])*drive
        if hands and aiming:
            r+=np.array([-.24,.1295,0]);l+=np.array([-.24,.1295,0])
        if hands and action=="idle":
            breath=.0025*math.sin(t*math.tau/3);r[1]+=breath;l[1]+=breath
        if action=="fire":
            k=smooth(t/.018) if t<.018 else math.exp(-(t-.018)*27)*math.cos((t-.018)*22)
            r+=np.array([0,.030,.065])*k;l+=np.array([0,.030,.065])*k;turn=axis([1,0,0],(-.16 if aiming else -.24)*k)
        elif action=="reload":
            k=pulse(t,0,.16,.96,1.25);drop=pulse(t,.20,.43,.69,.94)
            r+=np.array([-.10,.18,-.015])*k
            turn=axis([0,0,1],-.80*k)@axis([0,1,0],.35*k)@axis([1,0,0],.12*k)
            l+=(r+turn@np.array([-.035,-.055-.24*drop,-.025])-left)*k
        elif action in ["jab","cross","finish","strike"]:
            reach=pulse(t,.065,.20,.235,.5) if hands else pulse(t,.25,.40,.43,.65)
            wind=pulse(t,0,.07,.09,.15)
            if action=="jab":l+=np.array([-.14,.28,-.38])*reach+np.array([0,0,.06])*wind;r+=np.array([.10,-.09,.10])*reach
            else:r+=np.array([-.23,.28,-.38])*reach+np.array([0,0,.06])*wind;l+=np.array([-.03,.04,-.04])*reach
            if action=="finish":l+=np.array([-.08,.16,-.20])*reach
        if action=="death":
            fall=smooth(t/.65)
            r+=(np.array([.42,.80,.10])-r)*fall
            l+=(np.array([-.32,.91,.08])-l)*fall
        weapon_grip=hands and action not in ["cross","finish"] or not hands and action not in ["run","ready","strike","death"]
        support_grip=hands and action not in ["jab","finish"] or not hands and action not in ["run","ready","strike","death"]
        bend_r=[.05,-.2,1.] if action=="run" else [.2,-1,.2]
        bend_l=[-.05,-.2,1.] if action=="run" else [-.2,-1,.2]
        ik(ts,rs,C,"r",r,bend_r,turn,1.0 if weapon_grip else .55 if action=="death" else 1.4,grip="weapon" if weapon_grip and hit_side==0 and action!="held" else "fist")
        ik(ts,rs,C,"l",l,bend_l,axis([1,0,0],.45*reach) if action=="jab" else turn,1.0 if support_grip else .55 if action=="death" else 1.4,grip="weapon" if support_grip and hit_side==0 and action!="held" else "fist")
        if action=="hit":
            k=pulse(t,0,.06,.12,.65);i=names["spine_03"];rs[i]=rs[i]@axis([1,0,0],-.25*k);ts[names["pelvis"]]+=np.array([0,-.035*k,0])
        if action=="hit" and hit_side:
            k=pulse(t,0,.06,.12,.65)
            g=globals_for(ts,rs,C);i=names["spine_02"]
            desired=axis([0,1,0],hit_side*.32*k)@axis([0,0,1],hit_side*.12*k)@g[i][:3,:3]
            rs[i]=g[parents[i]][:3,:3].T@desired
        if action=="held":
            k=smooth(t/.18);i=names["spine_03"];rs[i]=rs[i]@axis([1,0,0],.14*k)
        if action=="death":
            shock=pulse(t,0,.045,.10,.38)
            g=globals_for(ts,rs,C);head=names["head"]
            desired=axis([0,0,1],.22*shock)@axis([1,0,0],.18*shock)@g[head][:3,:3]
            rs[head]=g[parents[head]][:3,:3].T@desired
            i=names["spine_03"];rs[i]=rs[i]@axis([1,0,0],-.18*shock)
            # Knees give way before the torso falls; limbs settle after impact.
            buckle=pulse(t,.04,.28,.42,1.05)
            settle=smooth((t-.60)/.45)
            for side,factor in [("l",1.0),("r",.72)]:
                for bone,angle in [("thigh_",.62*buckle+.16*settle),("calf_",-1.05*buckle-.30*settle)]:
                    g=globals_for(ts,rs,C);i=names[bone+side]
                    desired=axis([1,0,0],angle*factor)@g[i][:3,:3]
                    rs[i]=g[parents[i]][:3,:3].T@desired
            k=smooth((t-.10)/.72)
            impact=pulse(t,.72,.79,.82,1.05)
            i=names["Root"]
            rs[i]=axis([0,0,1],-.10*k)@axis([1,0,0],-1.48*k+.045*impact)@rs[i]
            ts[i]+=np.array([0,.13*k-.10*buckle+.018*impact,-.30*k])
            # Bake floor contact from the deformed surface, not a guessed bone
            # radius: shoes stay grounded and the settled body cannot hover.
            g=globals_for(ts,rs,C)
            palette=np.array([g[j] for j in joint_order])@skin_inverse
            surface=sum(np.einsum("nij,nj->ni",palette[skin_joints[:,n]],skin_points)*weights[:,n,None] for n in range(4))
            ts[i][1]+=.002-float(surface[:,1].min())
        return ts,rs
    idleT,idleR=pose("idle",0);g=globals_for(idleT,idleR,C)
    target=np.eye(4);target[:3,3]=[.24,-.20,-.50] if hands else [.14,1.36,-.46]
    socket=np.linalg.inv(g[names["hand_r"]])@target
    socketid=len(nodes);nodes[names["hand_r"]]["children"].append(socketid)
    nodes.append({"name":"weapon","translation":socket[:3,3].tolist(),"rotation":mq(socket[:3,:3]).tolist()})
    animations=[]
    clips=[("idle",3),("aim",3),("fire",.19),("aim_fire",.19),("reload",1.25),("jab",.5),("cross",.5),("finish",.5)] if hands else [("idle",3),("ready",3),("walk",.84),("run",.64),("hit",.65),("hit_left",.65),("hit_right",.65),("held",.28),("reload",1.25),("shoot",.65),("strike",.65),("death",1.05)]
    for action,duration in clips:
        times=np.linspace(0,duration,round(duration*60)+1);poses=[pose("fire" if action=="shoot" else action,max(0,float(t)-.40) if action=="shoot" else float(t)) for t in times]
        if action in ["idle","aim","ready","walk","run"]:poses[-1]=poses[0]
        channels=[];samplers=[];time=writer.data(times,"SCALAR")
        for j in range(53):
            qs=np.array([mq(r[j]) for _,r in poses])
            for k in range(1,len(qs)):
                if np.dot(qs[k-1],qs[k])<0:qs[k]*=-1
            for path,values,kind in [("rotation",qs,"VEC4"),("translation",[t[j] for t,_ in poses],"VEC3")]:
                output=writer.data(values,kind);samplers.append({"input":time,"output":output,"interpolation":"LINEAR"});channels.append({"sampler":len(samplers)-1,"target":{"node":j,"path":path}})
        animations.append({"name":action,"samplers":samplers,"channels":channels})
    doc={"nodes":nodes,"scenes":[{"nodes":[53,meshnode]}],"scene":0,"meshes":[{"name":name,"primitives":[{"attributes":attrs,"indices":index}]}],
        "skins":[{"name":name+"Rig","joints":joint_order,"inverseBindMatrices":inverse,"skeleton":root}],"animations":animations}
    writer.write(name,doc);atlas.save(OUT/(name+"-atlas.png"))
    print(name,len(pos),"vertices",len(indices)//3,"triangles",len(nodes),"nodes",flush=True)

if __name__ == "__main__":
    prepare("Enemy")
    prepare("Hands",True)

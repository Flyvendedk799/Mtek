"""Original deterministic hotel and weapon surface art; no external assets."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'target/rig-tools'))
import numpy as np
from PIL import Image,ImageDraw,ImageFont
out=Path(__file__).resolve().parents[1]/'textures';out.mkdir(exist_ok=True)
rng=np.random.default_rng(1701)
def save(name,a): Image.fromarray(np.uint8(np.clip(a,0,255))).save(out/(name+'.png'))
y,x=np.mgrid[0:1024,0:768];noise=rng.normal(0,1.4,x.shape)
vein=np.sin(x*.035+y*.017+3*np.sin(y*.009)+np.sin(x*.012))*2.5
v=39+vein+noise
floor=np.stack([v*.87,v*.96,v*1.07],axis=-1)
save("counter",floor)
# Large stone slabs, fine grout and brass perimeter inlays.
for yy in range(0,1024,128):floor[yy:yy+2,:,:]=[15,19,24]
for xx in range(0,768,128):floor[:,xx:xx+2,:]=[15,19,24]
for xx in [42,47,720,725]:floor[:,xx:xx+2,:]=[139,111,65]
for yy in [35,40,983,988]:floor[yy:yy+2,:,:]=[139,111,65]
save('stone',floor)
y,x=np.mgrid[0:512,0:512];g=7*np.sin(x*.27+1.8*np.sin(y*.012))+2*np.sin(x*1.1+y*.02)+rng.normal(0,1,(512,512))
wood=np.stack([65+g,43+g*.7,31+g*.5],axis=-1)
for xx in range(0,512,64):wood[:,xx:xx+2]=[23,19,17]
save('walnut',wood)
art=Image.new('RGB',(512,768),(16,29,36));d=ImageDraw.Draw(art)
for i in range(9):
 inset=26+i*15;d.arc((inset,100+inset,512-inset,600-inset),180,360,fill=(169-i*6,137-i*4,86-i*2),width=3)
 d.line((inset,350, inset,700-inset),fill=(139,113,73),width=2)
 d.line((512-inset,350,512-inset,700-inset),fill=(139,113,73),width=2)
d.ellipse((184,315,328,459),fill=(170,115,63));d.rectangle((0,500,512,504),fill=(80,126,128));art.save(out/'deco.png')
sign=Image.new('RGB',(1024,256),(15,22,26));d=ImageDraw.Draw(sign)
def font_for(paths,size):
    for path in paths:
        if Path(path).is_file(): return ImageFont.truetype(path,size)
    return ImageFont.load_default(size=size)
font=font_for(['C:/Windows/Fonts/times.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'],85)
small=font_for(['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],22)
d.rectangle((10,10,1013,245),outline=(161,133,86),width=3)
d.text((512,87),'THE MERIDIAN',font=font,anchor='mm',fill=(222,200,158))
d.text((512,177),'PRIVATE RESIDENCE   /   EST. 1927',font=small,anchor='mm',fill=(140,156,157));sign.save(out/'sign.png')
y,x=np.mgrid[0:256,0:256];v=134+rng.normal(0,2,(256,256))+3*np.sin(x*.9)
steel=np.stack([v*.91,v*.96,v],axis=-1)
for yy in range(184,243,9):steel[yy:yy+3]=[66,74,82];steel[yy+3:yy+4]=[180,188,193]
save('steel',steel)
v=55+rng.normal(0,5,(256,256));v-=((x%8<2)|(y%8<2))*12
save('grip',np.stack([v*.87,v*.94,v],axis=-1))
print('Generated original stone, walnut, deco art, hotel signage, machined steel and grip textures.')

y,x=np.mgrid[0:512,0:512]
v=184+7*np.sin(x*.023+y*.04+2*np.sin(x*.007))+rng.normal(0,1.2,x.shape)
save('travertine',np.stack([v,v*.96,v*.87],axis=-1))
v=64+((x%3)==0)*4+((y%3)==0)*3+rng.normal(0,1,x.shape)
save('velvet',np.stack([v,v*.44,v*.59],axis=-1))

import type { MtekSkin } from "../abi/manifest-types.js";

/** Linear blend skinning with inverse-transpose normals. All output storage is reused. */
export function deformSkin(skin: MtekSkin, palette: Float32Array, positions: Float32Array, normals: Float32Array | undefined, outPositions: Float32Array, outNormals: Float32Array): void {
  for(let v=0;v<skin.indices.length;v++) {
    const ids=skin.indices[v]!, ws=skin.weights[v]!;
    let a=0,b=0,c=0,d=0,e=0,f=0,g=0,h=0,i=0,tx=0,ty=0,tz=0;
    for(let k=0;k<4;k++) {
      const w=ws[k]!;
      if(w===0) continue;
      const j=ids[k]!*16;
      a+=palette[j]!*w; b+=palette[j+4]!*w; c+=palette[j+8]!*w;
      d+=palette[j+1]!*w; e+=palette[j+5]!*w; f+=palette[j+9]!*w;
      g+=palette[j+2]!*w; h+=palette[j+6]!*w; i+=palette[j+10]!*w;
      tx+=palette[j+12]!*w; ty+=palette[j+13]!*w; tz+=palette[j+14]!*w;
    }
    const at=v*3,x=positions[at]!,y=positions[at+1]!,z=positions[at+2]!;
    outPositions[at]=a*x+b*y+c*z+tx;outPositions[at+1]=d*x+e*y+f*z+ty;outPositions[at+2]=g*x+h*y+i*z+tz;
    if(normals!==undefined) {
      const nx=normals[at]!,ny=normals[at+1]!,nz=normals[at+2]!;
      const det=a*(e*i-f*h)+b*(f*g-d*i)+c*(d*h-e*g);
      const sign=det<0?-1:1;
      let ox=((e*i-f*h)*nx+(f*g-d*i)*ny+(d*h-e*g)*nz)*sign;
      let oy=((c*h-b*i)*nx+(a*i-c*g)*ny+(b*g-a*h)*nz)*sign;
      let oz=((b*f-c*e)*nx+(c*d-a*f)*ny+(a*e-b*d)*nz)*sign;
      let length=Math.hypot(ox,oy,oz);
      if(length<1e-10){ox=nx;oy=ny;oz=nz;length=Math.hypot(nx,ny,nz)||1;}
      outNormals[at]=ox/length;outNormals[at+1]=oy/length;outNormals[at+2]=oz/length;
    }
  }
}

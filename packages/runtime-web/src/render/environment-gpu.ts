import type { ResourceRegistry } from "../gpu/registry.js";
import type { EnvironmentLightingOptions } from "./options.js";
import { ENVIRONMENT_QUALITY } from "./environment.js";

// GGX importance sampling (N = V = reflection direction) and a correlated Smith-GGX
// split-sum integral. Linear HDR is retained in RGBA16F, independent of display encoding.
const COMMON = `
const PI = 3.141592653589793;
fn radicalInverse(bits:u32)->f32 { return f32(reverseBits(bits))*2.3283064365386963e-10; }
fn halfVector(i:u32,count:u32,roughness:f32)->vec3f {
  let a=roughness*roughness; let xi=vec2f(f32(i)/f32(count),radicalInverse(i));
  let phi=2.0*PI*xi.x;
  let ct=sqrt((1.0-xi.y)/max(1.0+(a*a-1.0)*xi.y,1e-8));
  let st=sqrt(max(0.0,1.0-ct*ct)); return vec3f(cos(phi)*st,sin(phi)*st,ct);
}
`;
const PREFILTER = `${COMMON}
struct Params { size:u32, samples:u32, roughness:f32, reserved:f32 }
@group(0) @binding(0) var panorama:texture_2d<f32>;
@group(0) @binding(1) var output:texture_storage_2d_array<rgba16float,write>;
@group(0) @binding(2) var<uniform> params:Params;
fn faceDirection(uv:vec2f,face:u32)->vec3f {
  switch face {
    case 0u:{return normalize(vec3f(1,-uv.y,-uv.x));}
    case 1u:{return normalize(vec3f(-1,-uv.y,uv.x));}
    case 2u:{return normalize(vec3f(uv.x,1,uv.y));}
    case 3u:{return normalize(vec3f(uv.x,-1,-uv.y));}
    case 4u:{return normalize(vec3f(uv.x,-uv.y,1));}
    default:{return normalize(vec3f(-uv.x,-uv.y,-1));}
  }
}
fn texel(p:vec2i)->vec3f {
  let size=vec2i(textureDimensions(panorama));
  return textureLoad(panorama,vec2i(((p.x%size.x)+size.x)%size.x,clamp(p.y,0,size.y-1)),0).rgb;
}
fn radiance(d:vec3f)->vec3f {
  let uv=vec2f(atan2(d.z,d.x)/(2.0*PI)+0.5,acos(clamp(d.y,-1.0,1.0))/PI);
  let p=uv*vec2f(textureDimensions(panorama))-0.5; let q=vec2i(floor(p)); let f=fract(p);
  return mix(mix(texel(q),texel(q+vec2i(1,0)),f.x),mix(texel(q+vec2i(0,1)),texel(q+vec2i(1,1)),f.x),f.y);
}
@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) id:vec3u) {
  if(id.x>=params.size || id.y>=params.size || id.z>=6u){return;}
  let n=faceDirection((vec2f(id.xy)+0.5)/f32(params.size)*2.0-1.0,id.z);
  if(params.roughness==0.0){textureStore(output,vec2i(id.xy),i32(id.z),vec4f(radiance(n),1));return;}
  let up=select(vec3f(0,0,1),vec3f(1,0,0),abs(n.z)>0.999);
  let t=normalize(cross(up,n)); let b=cross(n,t);
  var sum=vec3f(0);var weight=0.0;
  for(var i=0u;i<params.samples;i++) {
    let h0=halfVector(i,params.samples,params.roughness);let h=t*h0.x+b*h0.y+n*h0.z;
    let l=normalize(2.0*dot(n,h)*h-n);let nl=max(dot(n,l),0.0);
    if(nl>0.0){sum+=radiance(l)*nl;weight+=nl;}
  }
  textureStore(output,vec2i(id.xy),i32(id.z),vec4f(sum/max(weight,1e-8),1));
}
`;
const BRDF = `${COMMON}
@group(0) @binding(0) var output:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u) {
  let size=textureDimensions(output);if(any(id.xy>=size)){return;}
  let uv=(vec2f(id.xy)+0.5)/vec2f(size);let nv=uv.x;let roughness=uv.y;
  let v=vec3f(sqrt(1.0-nv*nv),0,nv);let a=roughness*roughness;let a2=a*a;
  var sum=vec2f(0);
  for(var i=0u;i<256u;i++) {
    let h=halfVector(i,256u,roughness);let vh=clamp(dot(v,h),0.0,1.0);let l=normalize(2.0*vh*h-v);
    let nl=max(l.z,0.0);let nh=max(h.z,1e-6);
    if(nl>0.0){
      let vis=0.5/max(nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2),1e-8);
      let g=4.0*nl*vis*vh/nh;let fc=pow(1.0-vh,5.0);sum+=vec2f((1.0-fc)*g,fc*g);
    }
  }
  textureStore(output,vec2i(id.xy),vec4f(sum/256.0,0,1));
}
`;

export interface GpuEnvironment { readonly texture: GPUTexture; readonly brdf: GPUTexture; readonly levels: number }
export interface LightingDevice {
  readonly queue: GPUQueue;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
}

/** Queue work is submitted before returning; subsequent scene draws observe the completed prefilter. */
export function prefilterEnvironment(device: LightingDevice, registry: ResourceRegistry, env?: EnvironmentLightingOptions): GpuEnvironment {
  const preset = ENVIRONMENT_QUALITY[env?.quality ?? "medium"];
  const size = env === undefined ? 1 : preset.size, levels = 1 + Math.log2(size);
  let texture: GPUTexture | undefined, brdf: GPUTexture | undefined;
  const transient: Array<GPUBuffer | GPUTexture | GPUBindGroup | GPUComputePipeline | GPUShaderModule> = [];
  try {
    texture = registry.createTexture({ label: "mtek environment GGX", size: [size, size, 6], mipLevelCount: levels, format: "rgba16float", usage: 0x0c });
    brdf = registry.createTexture({ label: "mtek environment BRDF", size: env === undefined ? [1, 1] : [64, 64], format: "rgba16float", usage: 0x0c });
    if (env === undefined) return { texture, brdf, levels };
    const panorama = registry.createTexture({ label: "mtek linear panorama", size: [env.width, env.height], format: "rgba32float", usage: 0x06 });
    transient.push(panorama);
    registry.writeTexture(device.queue, panorama, new Uint8Array(env.data.buffer, env.data.byteOffset, env.data.byteLength), env.width * 16, env.width, env.height);
    const params = registry.createBuffer({ label: "mtek environment prefilter params", size: levels * 256, usage: 0x48 });
    transient.push(params);
    const mirror = new ArrayBuffer(levels * 256), words = new Uint32Array(mirror), floats = new Float32Array(mirror);
    for (let level = 0; level < levels; level++) { words[level * 64] = size >> level; words[level * 64 + 1] = preset.samples; floats[level * 64 + 2] = level / (levels - 1); }
    registry.writeBuffer(device.queue, params, 0, mirror, 0, mirror.byteLength);
    const layout = registry.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 4, texture: { sampleType: "unfilterable-float" } },
      { binding: 1, visibility: 4, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d-array" } },
      { binding: 2, visibility: 4, buffer: { type: "uniform", minBindingSize: 16 } },
    ] });
    const module = registry.createShaderModule({ label: "mtek GGX prefilter", code: PREFILTER }); transient.push(module);
    const pipeline = registry.createComputePipeline({ layout: registry.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module, entryPoint: "main" } }); transient.push(pipeline);
    const encoder = device.createCommandEncoder({ label: "mtek environment preprocessing" });
    for (let level = 0; level < levels; level++) {
      const group = registry.createBindGroup({ layout, entries: [
        { binding: 0, resource: panorama.createView() },
        { binding: 1, resource: texture.createView({ dimension: "2d-array", baseMipLevel: level, mipLevelCount: 1 }) },
        { binding: 2, resource: { buffer: params, offset: level * 256, size: 16 } },
      ] }); transient.push(group);
      const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil((size >> level) / 8), Math.ceil((size >> level) / 8), 6); pass.end();
    }
    const brdfLayout = registry.createBindGroupLayout({ entries: [{ binding: 0, visibility: 4, storageTexture: { access: "write-only", format: "rgba16float" } }] });
    const brdfModule = registry.createShaderModule({ label: "mtek BRDF integration", code: BRDF }); transient.push(brdfModule);
    const brdfPipeline = registry.createComputePipeline({ layout: registry.createPipelineLayout({ bindGroupLayouts: [brdfLayout] }), compute: { module: brdfModule, entryPoint: "main" } }); transient.push(brdfPipeline);
    const brdfGroup = registry.createBindGroup({ layout: brdfLayout, entries: [{ binding: 0, resource: brdf.createView() }] }); transient.push(brdfGroup);
    const pass = encoder.beginComputePass(); pass.setPipeline(brdfPipeline); pass.setBindGroup(0, brdfGroup); pass.dispatchWorkgroups(8, 8); pass.end();
    device.queue.submit([encoder.finish()]);
    return { texture, brdf, levels };
  } catch (error) { if (texture !== undefined) registry.release(texture); if (brdf !== undefined) registry.release(brdf); throw error; }
  finally { for (const resource of transient) registry.release(resource); }
}

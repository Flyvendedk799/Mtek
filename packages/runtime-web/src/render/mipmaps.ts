import type { ResourceRegistry } from "../gpu/registry.js";

export function mipLevelCount(width: number, height: number): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new RangeError("Mip dimensions must be positive integers");
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

const SHADER = `
@group(0) @binding(0) var source: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
  let size=textureDimensions(source);
  let dst=max(vec2u(1),size/2u);
  let lo=vec2u(p.xy)*size/dst;
  let hi=(vec2u(p.xy)+1u)*size/dst;
  var color=vec4f(0); var count=0.0;
  for(var y=lo.y;y<hi.y;y++){for(var x=lo.x;x<hi.x;x++){
    color+=textureLoad(source,vec2i(vec2u(x,y)),0);count+=1.0;
  }}
  return color/count;
}`;

/** Full chain, including NPOT edges. sRGB views decode/encode so averaging is in linear light. */
export class MipmapGenerator {
  private readonly module: GPUShaderModule;
  private readonly layout: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;
  private readonly pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  constructor(
    private readonly device: Pick<GPUDevice, "createCommandEncoder" | "queue">,
    private readonly registry: ResourceRegistry,
  ) {
    this.module = registry.createShaderModule({
      label: "mtek mipmaps",
      code: SHADER,
    });
    this.layout = registry.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
      ],
    });
    this.pipelineLayout = registry.createPipelineLayout({
      bindGroupLayouts: [this.layout],
    });
  }
  generate(
    texture: GPUTexture,
    format: GPUTextureFormat,
    width: number,
    height: number,
  ): void {
    const levels = mipLevelCount(width, height);
    if (levels === 1) return;
    let pipeline = this.pipelines.get(format);
    if (pipeline === undefined) {
      pipeline = this.registry.createRenderPipeline({
        label: "mtek mipmaps",
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vs" },
        fragment: {
          module: this.module,
          entryPoint: "fs",
          targets: [{ format }],
        },
      });
      this.pipelines.set(format, pipeline);
    }
    const encoder = this.device.createCommandEncoder({ label: "mtek mipmaps" }),
      groups: GPUBindGroup[] = [];
    try {
      for (let level = 1; level < levels; level++) {
        const group = this.registry.createBindGroup({
          layout: this.layout,
          entries: [
            {
              binding: 0,
              resource: texture.createView({
                baseMipLevel: level - 1,
                mipLevelCount: 1,
              }),
            },
          ],
        });
        groups.push(group);
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: texture.createView({
                baseMipLevel: level,
                mipLevelCount: 1,
              }),
              loadOp: "clear",
              storeOp: "store",
              clearValue: [0, 0, 0, 0],
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
      }
      this.device.queue.submit([encoder.finish()]);
    } finally {
      for (const group of groups) this.registry.release(group);
    }
  }
  dispose(): void {
    for (const pipeline of this.pipelines.values())
      this.registry.release(pipeline);
    this.pipelines.clear();
    this.registry.release(this.module);
  }
}

import type { ResourceRegistry } from "../gpu/registry.js";
import type { PostEffect } from "./options.js";

const PREFIX = `
@group(0) @binding(0) var sceneColor:texture_2d<f32>;
@group(0) @binding(1) var sceneSampler:sampler;
fn sampleScene(uv:vec2f)->vec4f {return textureSampleLevel(sceneColor,sceneSampler,uv,0.0);}
struct VertexOut {@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn vs(@builtin(vertex_index) i:u32)->VertexOut {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var out:VertexOut;out.position=vec4f(p[i],0,1);out.uv=p[i]*vec2f(0.5,-0.5)+vec2f(0.5);return out;
}
@fragment fn fs(input:VertexOut)->@location(0) vec4f {return effect(sampleScene(input.uv),input.uv);}
`;

/** Versioned custom full-screen passes. Two scratch targets, bounded across resize/recovery. */
export class PostProcessor {
  private readonly layout: GPUBindGroupLayout;
  private readonly sampler: GPUSampler;
  private readonly modules: GPUShaderModule[] = [];
  private readonly pipelines: GPURenderPipeline[] = [];
  private textures: GPUTexture[] = [];
  private groups: GPUBindGroup[] = [];
  private width = 0;
  private height = 0;
  constructor(
    private readonly registry: ResourceRegistry,
    private readonly format: GPUTextureFormat,
    effects: readonly PostEffect[],
  ) {
    if (
      new Set(effects.map((e) => e.id)).size !== effects.length ||
      effects.some((e) => e.id === "")
    )
      throw new RangeError("Post effects require unique nonempty IDs");
    this.layout = registry.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: 2, texture: { sampleType: "float" } },
        { binding: 1, visibility: 2, sampler: { type: "filtering" } },
      ],
    });
    this.sampler = registry.createSampler({
      minFilter: "linear",
      magFilter: "linear",
    });
    const layout = registry.createPipelineLayout({
      bindGroupLayouts: [this.layout],
    });
    for (const effect of effects) {
      const module = registry.createShaderModule({
        label: `mtek post effect ${effect.id}`,
        code: PREFIX + effect.wgsl,
      });
      this.modules.push(module);
      this.pipelines.push(
        registry.createRenderPipeline({
          label: `mtek post effect ${effect.id}`,
          layout,
          vertex: { module, entryPoint: "vs" },
          fragment: { module, entryPoint: "fs", targets: [{ format }] },
        }),
      );
    }
  }
  input(width: number, height: number): GPUTextureView {
    if (width !== this.width || height !== this.height) {
      this.releaseTargets();
      this.width = width;
      this.height = height;
      for (let i = 0; i < Math.min(2, this.pipelines.length); i++) {
        const texture = this.registry.createTexture({
          label: "mtek post scratch",
          size: [width, height],
          format: this.format,
          usage: 0x14,
        });
        this.textures.push(texture);
        this.groups.push(
          this.registry.createBindGroup({
            layout: this.layout,
            entries: [
              { binding: 0, resource: texture.createView() },
              { binding: 1, resource: this.sampler },
            ],
          }),
        );
      }
    }
    return this.textures[0]!.createView();
  }
  async validate(): Promise<void> {
    const infos = await Promise.all(
      this.modules.map((module) => module.getCompilationInfo()),
    );
    const errors = infos.flatMap((info) =>
      info.messages.filter((m) => m.type === "error").map((m) => m.message),
    );
    if (errors.length > 0)
      throw new Error(`Post-processing WGSL failed: ${errors.join("; ")}`);
  }
  encode(encoder: GPUCommandEncoder, output: GPUTextureView): void {
    for (let i = 0; i < this.pipelines.length; i++) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view:
              i === this.pipelines.length - 1
                ? output
                : this.textures[(i + 1) % 2]!.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(this.pipelines[i]!);
      pass.setBindGroup(0, this.groups[i % 2]);
      pass.draw(3);
      pass.end();
    }
  }
  private releaseTargets(): void {
    for (const group of this.groups) this.registry.release(group);
    for (const texture of this.textures) this.registry.release(texture);
    this.groups = [];
    this.textures = [];
  }
  dispose(): void {
    this.releaseTargets();
    for (const pipeline of this.pipelines) this.registry.release(pipeline);
    for (const module of this.modules) this.registry.release(module);
    this.registry.release(this.sampler);
  }
}

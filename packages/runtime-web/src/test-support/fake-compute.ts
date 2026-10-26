/** CPU-only command recording for compute lifetime/ordering tests. It runs an
 * injected CPU callback, never WGSL; it cannot establish shader correctness. */
import { FakeDevice, FakeResource, type FakeBindGroup, type FakeBuffer, type FakeCommandBuffer } from "./fake-gpu.js";

export class FakeComputeDevice extends FakeDevice {
  readonly dispatches: { groups: readonly number[]; buffers: ReadonlyMap<number, FakeBuffer> }[] = [];
  kernel: (buffers: ReadonlyMap<number, FakeBuffer>, groups: readonly number[]) => void = () => undefined;
  rejectDispatch = false;

  createComputePipeline(descriptor: unknown): FakeResource { return new FakeResource("computePipeline", descriptor); }
  validation(message: string): void { this.raise("validation", message); }

  createCommandEncoder(): {
    clearBuffer(buffer: FakeBuffer): void;
    copyBufferToBuffer(source: FakeBuffer, sourceOffset: number, destination: FakeBuffer, destinationOffset: number, size: number): void;
    beginComputePass(): {
      setPipeline(pipeline: object): void;
      setBindGroup(index: number, group: FakeBindGroup): void;
      dispatchWorkgroups(x: number, y?: number, z?: number): void;
      end(): void;
    };
    finish(): FakeCommandBuffer;
  } {
    const commands: (() => void)[] = [];
    let finished = false;
    let activePass = false;
    const recording = (): void => { if (finished || activePass) throw new Error("encoder is not recording outside a pass"); };
    return {
      clearBuffer: (buffer) => {
        recording();
        if ((buffer.usage & 0x08) === 0) throw new Error("clearBuffer needs COPY_DST");
        commands.push(() => {
          if (buffer.destroyed) throw new Error("clearBuffer of a destroyed buffer");
          this.events.push("clearBuffer"); buffer.contents.fill(0);
        });
      },
      copyBufferToBuffer: (source, sourceOffset, destination, destinationOffset, size) => {
        recording();
        if ((source.usage & 0x04) === 0 || (destination.usage & 0x08) === 0) throw new Error("copy buffer usage");
        if ([sourceOffset, destinationOffset, size].some((n) => !Number.isInteger(n) || n < 0 || n % 4 !== 0) || sourceOffset + size > source.size || destinationOffset + size > destination.size) throw new Error("copy range");
        commands.push(() => {
          if (source.destroyed || destination.destroyed) throw new Error("copy of a destroyed buffer");
          this.events.push("copyBufferToBuffer");
          destination.contents.set(source.contents.subarray(sourceOffset, sourceOffset + size), destinationOffset);
        });
      },
      beginComputePass: () => {
        recording(); activePass = true;
        let ended = false;
        let pipeline: object | undefined;
        let group: FakeBindGroup | undefined;
        const live = (): void => { if (ended) throw new Error("compute pass ended"); };
        return {
          setPipeline: (value) => { live(); pipeline = value; },
          setBindGroup: (index, value) => { live(); if (index !== 0) throw new Error("only group zero is modeled"); group = value; },
          dispatchWorkgroups: (x, y = 1, z = 1) => {
            live();
            if (pipeline === undefined || group === undefined) throw new Error("missing compute pipeline/group");
            const buffers = new Map(group.descriptor.entries.map((entry) => [entry.binding, entry.resource.buffer]));
            const groups = [x, y, z];
            commands.push(() => {
              if (this.rejectDispatch) { this.validation("injected dispatch validation failure"); return; }
              for (const buffer of buffers.values()) if (buffer.destroyed) throw new Error("dispatch of a destroyed buffer");
              this.events.push("dispatch");
              this.dispatches.push({ groups, buffers });
              this.kernel(buffers, groups);
            });
          },
          end: () => { live(); ended = true; activePass = false; },
        };
      },
      finish: () => {
        recording(); finished = true;
        let executed = false;
        return { execute: () => { if (executed) throw new Error("command buffer submitted twice"); executed = true; for (const command of commands) command(); } };
      },
    };
  }
}

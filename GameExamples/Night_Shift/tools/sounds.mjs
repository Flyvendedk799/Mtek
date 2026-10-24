// Original deterministic synthesized Foley. Run with Node; no downloaded assets.
import { writeFileSync } from 'node:fs';
const rate = 22050;
let seed = 9173;
const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
function wav(name, duration, sample) {
  const n = Math.ceil(rate * duration), data = Buffer.alloc(44 + n * 2);
  data.write('RIFF'); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / rate))) * 26000), 44 + i * 2);
  writeFileSync(new URL(`../sounds/${name}.wav`, import.meta.url), data);
}
wav('shot', .22, t => noise() * Math.exp(-t * 55) * .65 + Math.sin(2 * Math.PI * (110 * t - 150 * t * t)) * Math.exp(-t * 24) * .5);
wav('hit', .18, t => noise() * Math.exp(-t * 35) * .3 + Math.sin(t * 2 * Math.PI * 75) * Math.exp(-t * 25) * .65);
wav('reload', 1.25, t => [0, .40, .95, 1.12].reduce((v, s) => v + (t >= s ? noise() * Math.exp(-(t - s) * 95) * .5 : 0), 0));
wav('chime', .75, t => Math.sin(t * 2 * Math.PI * 660) * Math.exp(-t * 7) * .25 + (t > .13 ? Math.sin((t - .13) * 2 * Math.PI * 990) * Math.exp(-(t - .13) * 8) * .25 : 0));
let filtered = 0;
wav('swing', .28, t => {
  filtered = filtered * .78 + noise() * .22;
  return filtered * Math.sin(Math.PI * t / .28) ** 2 * .7;
});

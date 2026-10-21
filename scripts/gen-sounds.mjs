#!/usr/bin/env node
// Writes the tiny, deterministic WAV files of examples/arcade-audio/sounds and of the audio fixtures
// (spec/audio.md section 7, decision 0160). No recording is checked in that this script cannot
// reproduce: every sample is computed here, 8-bit mono PCM at 11 025 Hz, so the files stay small.
//
//   node scripts/gen-sounds.mjs           writes the files
//   node scripts/gen-sounds.mjs --check   fails if a file on disk differs from what it would write
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 11025;

/** A WAV file (RIFF, PCM, 8-bit unsigned, mono) of samples in [-1, 1]. */
function wav(samples) {
  const data = Buffer.alloc(samples.length);
  samples.forEach((s, i) => {
    data[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * Math.max(-1, Math.min(1, s)))));
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length + (data.length & 1), 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  const pad = data.length & 1 ? Buffer.from([0x80]) : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

/** A deterministic noise source (xorshift32), so the hit sound is the same on every run. */
function noise(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x / 0xffffffff) * 2 - 1;
  };
}

function tone(seconds, f, { wave = "square", decay = 0, gain = 0.6 } = {}) {
  const n = Math.round(seconds * RATE);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = typeof f === "function" ? f(t) : f;
    const phase = (freq * t) % 1;
    const v = wave === "square" ? (phase < 0.5 ? 1 : -1) : wave === "triangle" ? 4 * Math.abs(phase - 0.5) - 1 : Math.sin(2 * Math.PI * phase);
    const env = decay > 0 ? Math.exp(-t * decay) : 1;
    // 5 ms fade in and out against clicks.
    const edge = Math.min(1, i / (0.005 * RATE), (n - 1 - i) / (0.005 * RATE));
    out[i] = v * env * gain * edge;
  }
  return out;
}

function hit() {
  const rnd = noise(0x5eed);
  const n = Math.round(0.12 * RATE);
  return Array.from({ length: n }, (_, i) => rnd() * Math.exp((-i / RATE) * 40) * 0.8);
}

function score() {
  return [...tone(0.07, 880, { decay: 8 }), ...tone(0.12, 1320, { decay: 10 })];
}

/** Two bars of an arpeggio that loops without a seam (each note is whole periods long enough). */
function music() {
  const notes = [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 293.66];
  const out = [];
  for (const f of notes) out.push(...tone(0.25, f, { wave: "triangle", decay: 3, gain: 0.35 }));
  return out;
}

const files = {
  "examples/arcade-audio/sounds/hit.wav": wav(hit()),
  "examples/arcade-audio/sounds/score.wav": wav(score()),
  "examples/arcade-audio/sounds/music.wav": wav(music()),
  "tests/assets/pass/audio_sounds/sounds/blip.wav": wav(tone(0.05, 660)),
  // E7101: a FLAC file (only its magic and a few header bytes), and a WAV file named .mp3.
  "tests/assets/fail/e7101_unsupported_audio/sounds/voice.flac": Buffer.concat([Buffer.from("fLaC", "ascii"), Buffer.alloc(38)]),
  "tests/assets/fail/e7101_unsupported_audio/sounds/named_wrong.mp3": wav(tone(0.02, 440)),
  // E7102: a WAV file cut off inside its data chunk.
  "tests/assets/fail/e7102_truncated_wav/sounds/cut.wav": wav(tone(0.05, 440)).subarray(0, 120),
};

const check = process.argv.includes("--check");
let stale = 0;
for (const [path, bytes] of Object.entries(files)) {
  const full = join(root, path);
  if (check) {
    if (!existsSync(full) || !readFileSync(full).equals(bytes)) {
      console.error(`stale: ${path} (run node scripts/gen-sounds.mjs)`);
      stale++;
    }
    continue;
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
  console.log(`wrote ${path} (${bytes.length} bytes)`);
}
process.exit(stale ? 1 : 0);

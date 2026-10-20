import { readFileSync, writeFileSync } from "node:fs";
const [, , csv, output] = process.argv;
if (!csv || !output) throw new Error("samples.csv summary.json required");
const groups = new Map();
for (const row of readFileSync(csv, "utf8").trim().split(/\r?\n/).slice(1)) {
  const [revision, , shape, count, operation, , nanoseconds] = row.split(",");
  const key = `${shape},${count},${operation}`;
  if (!groups.has(key)) groups.set(key, { shape, count: Number(count), operation, before: [], after: [] });
  groups.get(key)[revision].push(Number(nanoseconds) / 1e6);
}
function stats(values) {
  if (values.length !== 9 || values.some((value) => !Number.isFinite(value))) throw new Error("expected 9 finite samples");
  values.sort((a, b) => a - b);
  return { minMs: values[0], medianMs: values[4], maxMs: values[8] };
}
const summary = [...groups.values()].map(({ before, after, ...group }) => ({ ...group, before: stats(before), after: stats(after) }));
writeFileSync(output, JSON.stringify(summary, null, 2) + "\n");
console.log("| Workload | Count | Operation | Before median ms (min–max) | After median ms (min–max) | Ratio |\n| --- | ---: | --- | ---: | ---: | ---: |");
for (const { shape, count, operation, before, after } of summary) {
  const format = (s) => `${s.medianMs.toFixed(3)} (${s.minMs.toFixed(3)}–${s.maxMs.toFixed(3)})`;
  console.log(`| ${shape} | ${count} | ${operation} | ${format(before)} | ${format(after)} | ${(before.medianMs / after.medianMs).toFixed(2)}× |`);
}

import { mkdir, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "vendor");
const nm = path.join(root, "node_modules");

const files = [
  ["chart.js/dist/chart.umd.js", "chart.umd.js"],
  ["three/build/three.module.js", "three.module.js"],
  ["three/build/three.core.js", "three.core.js"], // există doar în three >= r171
  ["three/examples/jsm/controls/OrbitControls.js", "OrbitControls.js"]
];

await mkdir(out, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(nm, from);
  try {
    await access(src);
  } catch {
    if (to === "three.core.js") continue;
    throw new Error(`Lipsește ${from} — rulează npm install`);
  }
  await copyFile(src, path.join(out, to));
}
console.log("vendor/ actualizat");
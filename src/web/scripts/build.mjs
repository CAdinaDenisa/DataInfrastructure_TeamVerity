import { rm, mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const vendorDir = path.join(distDir, "vendor");
const assetsSrcDir = path.join(rootDir, "assets");
const assetsDistDir = path.join(distDir, "assets");

const publicFiles = [
  "index.html",
  "report.html",
  "app.js",
  "api.js",
  "recs.js",
  "report.js",
  "scene3d.js",
  "styles.css",
  "config.example.js"
];

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(assetsDistDir, { recursive: true });

  for (const file of publicFiles) {
    await copyFile(path.join(rootDir, file), path.join(distDir, file));
  }

  // config.js (local, ignorat de git) dacă există; altfel config.example.js devine config.js
  try {
    await copyFile(path.join(rootDir, "config.js"), path.join(distDir, "config.js"));
  } catch (_) {
    await copyFile(path.join(rootDir, "config.example.js"), path.join(distDir, "config.js"));
  }

  try {
    const assetFiles = await readdir(assetsSrcDir);
    for (const asset of assetFiles) {
      await copyFile(path.join(assetsSrcDir, asset), path.join(assetsDistDir, asset));
    }
  } catch (_) {
    console.warn("Atenție: folderul assets/ lipsește sau este gol.");
  }

  // vendor/ (chart.js + three.js) -> dist/vendor
  const vendorSrc = path.join(rootDir, "vendor");
  for (const f of await readdir(vendorSrc)) {
    await copyFile(path.join(vendorSrc, f), path.join(vendorDir, f));
  }

  console.log("Build finalizat cu succes în src/web/dist!");
}

build().catch((err) => {
  console.error("Eroare la build:", err);
  process.exit(1);
});
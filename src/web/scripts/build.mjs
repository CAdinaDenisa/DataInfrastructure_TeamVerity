import { rm, mkdir, copyFile, readdir, access } from "node:fs/promises";
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
  "report.js",
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

  // Copiază imaginile mașinilor din assets/
  try {
    const assetFiles = await readdir(assetsSrcDir);
    for (const asset of assetFiles) {
      await copyFile(path.join(assetsSrcDir, asset), path.join(assetsDistDir, asset));
    }
  } catch (_) {
    console.warn("Atenție: folderul assets/ lipsește sau este gol.");
  }

  // Păstrăm și vendor/chart.umd.js pentru compatibilitate cu build-ul
  const chartSrc = path.join(rootDir, "node_modules", "chart.js", "dist", "chart.umd.js");
  const chartDest = path.join(vendorDir, "chart.umd.js");
  await access(chartSrc);
  await copyFile(chartSrc, chartDest);

  console.log("Build finalizat cu succes în src/web/dist!");
}

build().catch((err) => {
  console.error("Eroare la build:", err);
  process.exit(1);
});
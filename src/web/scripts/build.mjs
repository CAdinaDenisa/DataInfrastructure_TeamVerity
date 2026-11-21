import { rm, mkdir, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const vendorDir = path.join(distDir, "vendor");

const publicFiles = [
  "index.html",
  "app.js",
  "charts.js",
  "styles.css",
  "config.example.js"
];

async function build() {
  // 1. Curăță folderul dist
  await rm(distDir, { recursive: true, force: true });

  // 2. Creează dist și dist/vendor
  await mkdir(vendorDir, { recursive: true });

  // 3. Copiază fișierele publice (fără credențiale / config.js)
  for (const file of publicFiles) {
    const src = path.join(rootDir, file);
    const dest = path.join(distDir, file);
    await copyFile(src, dest);
  }

  // 4. Copiază bundle-ul UMD Chart.js în dist/vendor
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
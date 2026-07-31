// PWA 安装图示产生器：只在需要重新产生 icon 时手动跑一次（`node scripts/generate-pwa-icons.mjs`），
// 不是 build 流程的一部分——sharp 只是 devDependency，不会进最终产物。
// iOS Safari 的 apple-touch-icon 不支援 SVG，必须是 PNG；Android Chrome 的安装横幅则同时
// 认 SVG 跟 PNG，但 maskable icon（供系统套用圆形/圆角裁切）一定要是有留白 safe zone 的 PNG。
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const iconsDir = path.join(publicDir, "icons");
mkdirSync(iconsDir, { recursive: true });

const svgBuffer = readFileSync(path.join(publicDir, "favicon.svg"));

async function renderStandard(size, filename) {
  await sharp(svgBuffer, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 245, g: 245, b: 245, alpha: 1 } })
    .png()
    .toFile(path.join(iconsDir, filename));
}

// Maskable icon：系统裁切时只保证中间 80% 的「safe zone」看得到，四周留白让 Logo 缩到画面
// 60% 左右，避免圆形/圆角裁切把图案边缘切掉。
async function renderMaskable(size, filename) {
  const logoSize = Math.round(size * 0.6);
  const logo = await sharp(svgBuffer, { density: 384 }).resize(logoSize, logoSize, { fit: "contain" }).toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 245, g: 245, b: 245, alpha: 1 } }
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(iconsDir, filename));
}

await renderStandard(192, "icon-192.png");
await renderStandard(512, "icon-512.png");
await renderStandard(180, "apple-touch-icon.png");
await renderMaskable(512, "icon-maskable-512.png");

console.log("PWA icons written to", iconsDir);

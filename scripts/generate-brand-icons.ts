import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

// The mark is a stressed Q whose tail is the end-of-proof tombstone: a question
// that ends in Q.E.D. This file is the single source of the geometry; every
// committed icon is generated from it with `npm run brand:icons`.

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const paper = "#FBFCFA";
const ink = "#14264F";
const inkLit = "#1A3060";
const tombstone = "#E5526D";

// All geometry lives on Apple's 1024 grid, where the tile spans 100..924.
const tile = { start: 100, size: 824, exponent: 5.6 } as const;

type Mark = {
  cx: number;
  cy: number;
  radius: number;
  counter: { rx: number; ry: number };
  block: { x: number; y: number; width: number; height: number };
  gap: number;
};

const displayMark: Mark = {
  cx: 512,
  cy: 505,
  radius: 262,
  counter: { rx: 152, ry: 214 },
  block: { x: 668, y: 645, width: 96, height: 136 },
  gap: 20
};

// Below about 64px the display mark's thin side and tail collapse, so small
// sizes use a heavier, larger drawing rather than a downscale.
const smallMark: Mark = {
  cx: 500,
  cy: 498,
  radius: 306,
  counter: { rx: 150, ry: 232 },
  block: { x: 662, y: 640, width: 164, height: 198 },
  gap: 30
};

type Frame = {
  viewBox: readonly [number, number, number, number];
  lit: boolean;
  shadow: boolean;
};

const macFrame: Frame = { viewBox: [0, 0, 1024, 1024], lit: true, shadow: true };
const windowsFrame: Frame = { viewBox: [76, 76, 872, 872], lit: true, shadow: false };
const bleedFrame: Frame = { viewBox: [100, 100, 824, 824], lit: false, shadow: false };

function tilePath() {
  const radius = tile.size / 2;
  const center = tile.start + radius;
  const power = 2 / tile.exponent;
  const points: string[] = [];
  for (let step = 0; step < 720; step += 1) {
    const angle = (step / 720) * 2 * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = center + radius * Math.sign(cos) * Math.abs(cos) ** power;
    const y = center + radius * Math.sign(sin) * Math.abs(sin) ** power;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M${points.join("L")}Z`;
}

function ringPath({ cx, cy, radius, counter }: Mark) {
  const ellipse = (rx: number, ry: number) =>
    `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
  return ellipse(radius, radius) + ellipse(counter.rx, counter.ry);
}

function iconSvg(mark: Mark, frame: Frame, size: number) {
  const { block, gap } = mark;
  const shape = tilePath();
  const fill = frame.lit ? "url(#tile)" : ink;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.viewBox.join(" ")}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${inkLit}"/>
      <stop offset="1" stop-color="${ink}"/>
    </linearGradient>
    <filter id="shadow" x="0" y="0" width="1024" height="1024" filterUnits="userSpaceOnUse">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
    <mask id="tail" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <rect x="${block.x - gap}" y="${block.y - gap}" width="${block.width + 2 * gap}" height="${block.height + 2 * gap}" fill="#000"/>
    </mask>
  </defs>
  ${frame.shadow ? `<path d="${shape}" transform="translate(0 10)" fill="#0B1020" fill-opacity=".3" filter="url(#shadow)"/>` : ""}
  <path d="${shape}" fill="${fill}"/>
  ${frame.lit ? `<path d="${shape}" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="3"/>` : ""}
  <path d="${ringPath(mark)}" fill="${paper}" fill-rule="evenodd" mask="url(#tail)"/>
  <rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="${tombstone}"/>
</svg>
`;
}

function renderPng(mark: Mark, frame: Frame, size: number) {
  return sharp(Buffer.from(iconSvg(mark, frame, size))).png({ compressionLevel: 9 }).toBuffer();
}

const markForSize = (size: number) => (size < 64 ? smallMark : displayMark);

async function buildIcns() {
  // iconutil writes the legacy 16px encodings that a hand-rolled PNG entry would
  // corrupt. The .icns is committed, so only regenerating it needs macOS.
  const iconset = path.join(projectRoot, ".tmp", "brand-icons", "icon.iconset");
  const output = path.join(projectRoot, "build-resources", "icon.icns");
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  try {
    for (const points of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const size = points * scale;
        const suffix = scale === 2 ? "@2x" : "";
        await writeFile(
          path.join(iconset, `icon_${points}x${points}${suffix}.png`),
          await renderPng(markForSize(size), macFrame, size)
        );
      }
    }
    await run("iconutil", ["-c", "icns", "-o", output, iconset]);
  } finally {
    await rm(path.dirname(iconset), { recursive: true, force: true });
  }
  console.log("Wrote build-resources/icon.icns");
}

async function buildIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map((size) => renderPng(markForSize(size), windowsFrame, size))
  );
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    const image = images[index]!;
    // A zero byte means 256 in the ICO directory.
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

async function main() {
  await buildIcns();
  const outputs: [string, Buffer | string][] = [
    ["build-resources/icon.ico", await buildIco()],
    ["build-resources/icon.png", await renderPng(displayMark, macFrame, 1024)],
    ["docs/brand/icon.png", await renderPng(displayMark, macFrame, 256)],
    ["docs/brand/icon.svg", iconSvg(displayMark, macFrame, 1024)],
    ["public/brand/icon-64.png", await renderPng(smallMark, bleedFrame, 64)]
  ];
  for (const [relativePath, content] of outputs) {
    const target = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
    console.log(`Wrote ${relativePath}`);
  }
}

await main();

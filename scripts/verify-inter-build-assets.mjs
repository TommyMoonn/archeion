import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "scripts/inter-font-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceRoot = path.join(
  projectRoot,
  "node_modules",
  manifest.packageName,
  manifest.sourceDirectory,
);
const outputRoot = path.join(projectRoot, "dist");

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fail(message) {
  throw new Error(`Inter asset verification failed: ${message}`);
}

if (!fs.existsSync(sourceRoot)) {
  fail(
    `${path.relative(projectRoot, sourceRoot)} is missing; install the pinned development dependencies first`,
  );
}

if (!fs.existsSync(outputRoot)) {
  fail("dist does not exist; run npm run build first");
}

const sourceAssets = manifest.assets.map((asset) => {
  const filePath = path.join(sourceRoot, asset.fileName);

  if (!fs.existsSync(filePath)) {
    fail(`${path.relative(projectRoot, filePath)} is missing`);
  }

  const hash = sha256(filePath);
  if (hash !== asset.sha256) {
    fail(`${asset.fileName} has SHA-256 ${hash}, expected ${asset.sha256}`);
  }

  return { ...asset, filePath, hash };
});

const outputFiles = collectFiles(outputRoot);
const outputFonts = outputFiles.filter((filePath) => path.extname(filePath) === ".woff2");
const emittedInterAssets = sourceAssets.map((sourceAsset) => {
  const matches = outputFonts.filter((filePath) => sha256(filePath) === sourceAsset.hash);

  if (matches.length !== 1) {
    fail(`${sourceAsset.fileName} was emitted ${matches.length} times instead of once`);
  }

  return { ...sourceAsset, emittedPath: matches[0] };
});
const builtCss = outputFiles
  .filter((filePath) => path.extname(filePath) === ".css")
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");

if (/https?:\/\//i.test(builtCss)) {
  fail("built CSS contains a remote URL");
}
if (/local\s*\(/i.test(builtCss)) {
  fail("built CSS contains a local() font source");
}
if (/node_modules|src\/assets\/fonts\/inter/i.test(builtCss)) {
  fail("built CSS exposes a source-tree font path");
}

const fontFaceBlocks = [...builtCss.matchAll(/@font-face\s*{([\s\S]*?)}/g)].map(
  (match) => match[1] ?? "",
);
const interFontFaces = fontFaceBlocks.filter((block) =>
  emittedInterAssets.some((asset) => block.includes(path.basename(asset.emittedPath))),
);

if (interFontFaces.length !== manifest.assets.length) {
  fail(`expected ${manifest.assets.length} built Inter font faces, found ${interFontFaces.length}`);
}

for (const asset of emittedInterAssets) {
  const emittedName = path.basename(asset.emittedPath);
  const blocks = interFontFaces.filter((block) => block.includes(emittedName));

  if (blocks.length !== 1) {
    fail(`${emittedName} is referenced by ${blocks.length} Inter font faces instead of once`);
  }

  const [block] = blocks;
  if (!block.includes(`font-weight:${asset.weight}`)) {
    fail(`${emittedName} does not declare weight ${asset.weight}`);
  }
  if (!block.includes(`font-display:${manifest.fontDisplay}`)) {
    fail(`${emittedName} does not declare font-display ${manifest.fontDisplay}`);
  }
  if (!/format\(["']?woff2["']?\)/i.test(block)) {
    fail(`${emittedName} does not declare WOFF2`);
  }
}

console.log(
  `Verified ${emittedInterAssets.length} bundled Inter WOFF2 assets and local CSS references.`,
);

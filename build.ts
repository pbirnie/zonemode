import { build } from "bun";
import { copyFile, mkdir } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

/** Built extension root (Load unpacked → this folder). */
const OUT_DIR = "dist";

/** Non-minified builds when running `bun --watch build.ts --dev` or legacy `--watch` argv. */
const isDev =
  process.argv.includes("--dev") || process.argv.includes("--watch");

/** Shim `import.meta` for bundles that are not ES modules (classic content script, SW). */
const CONTENT_SCRIPT_IMPORT_META_URL =
  '(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.getURL?chrome.runtime.getURL("content/index.js"):"")';

const BG_IMPORT_META_URL =
  '(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.getURL?chrome.runtime.getURL("background/index.js"):"")';

const TEST_BENCH_IMPORT_META_URL =
  '(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.getURL?chrome.runtime.getURL("test-bench/index.js"):"")';

const baseBundleConfig = {
  minify: !isDev,
  /** External .map files next to bundles for Chrome DevTools. */
  sourcemap: "linked" as const,
};

/** Only the YouTube content bundle (classic script); do not point SW/popup at `content/index.js`. */
const contentScriptBundleConfig = {
  ...baseBundleConfig,
  define: {
    "import.meta.env.DEV": JSON.stringify(isDev),
    "import.meta": `({url:${CONTENT_SCRIPT_IMPORT_META_URL}})`,
  },
};

/** Background service worker bundle — MV3 orchestrator only (no ORT / OpenRouter / youtubei; see `orchestrator.ts`). */
const backgroundBundleConfig = {
  ...baseBundleConfig,
  define: {
    "import.meta.env.DEV": JSON.stringify(isDev),
    "import.meta": `({url:${BG_IMPORT_META_URL}})`,
  },
};

const OFFSCREEN_IMPORT_META_URL =
  '(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.getURL?chrome.runtime.getURL("offscreen/offscreen.js"):"")';

const offscreenBundleConfig = {
  ...baseBundleConfig,
  define: {
    "import.meta.env.DEV": JSON.stringify(isDev),
    "import.meta": `({url:${OFFSCREEN_IMPORT_META_URL}})`,
  },
};

/** Classifier test-bench extension page; `import.meta` shim matches other classic bundles. */
const testBenchBundleConfig = {
  ...baseBundleConfig,
  define: {
    "import.meta.env.DEV": JSON.stringify(isDev),
    "import.meta": `({url:${TEST_BENCH_IMPORT_META_URL}})`,
  },
};

const defaultBundleConfig = {
  ...baseBundleConfig,
  define: {
    "import.meta.env.DEV": JSON.stringify(isDev),
  },
};

// Create a simple SVG icon
const createSVG = (size: number) => `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="#FF0000"/>
  <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="white" font-family="Arial" font-size="${
    size / 2
  }">S</text>
</svg>`;

async function createIcons() {
  // Create icons directory
  const iconsDir = join(OUT_DIR, "icons");
  await mkdir(iconsDir, { recursive: true });

  // Create icons of different sizes
  const sizes = [16, 48, 128];

  for (const size of sizes) {
    const svg = createSVG(size);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(join(iconsDir, `icon${size}.png`));
  }
}

export async function copyStaticFiles() {
  // Ensure directories exist
  await mkdir(join(OUT_DIR, "content"), { recursive: true });
  await mkdir(join(OUT_DIR, "popup"), { recursive: true });
  await mkdir(join(OUT_DIR, "test-bench"), { recursive: true });
  await mkdir(join(OUT_DIR, "offscreen"), { recursive: true });

  // Copy static files
  await copyFile(
    "src/static/styles/styles.css",
    join(OUT_DIR, "content/styles.css")
  );
  await copyFile(
    "src/static/manifest/manifest.json",
    join(OUT_DIR, "manifest.json")
  );
  await copyFile(
    "src/static/popup/index.html",
    join(OUT_DIR, "popup/index.html")
  );
  await copyFile(
    "src/static/popup/styles.css",
    join(OUT_DIR, "popup/styles.css")
  );
  await copyFile(
    "src/test-bench/index.html",
    join(OUT_DIR, "test-bench/index.html")
  );
  await copyFile(
    "src/static/offscreen/offscreen.html",
    join(OUT_DIR, "offscreen/offscreen.html")
  );
}

async function buildExtension() {
  try {
    // Create extension icons
    await createIcons();

    // Build content script (browser target for youtubei.js web platform)
    await build({
      entrypoints: ["./src/content/index.ts"],
      outdir: `./${OUT_DIR}/content`,
      target: "browser",
      ...contentScriptBundleConfig,
    });

    // Build background (orchestrator only — heavy work is in offscreen)
    await build({
      entrypoints: ["./src/background/index.ts"],
      outdir: `./${OUT_DIR}/background`,
      target: "browser",
      ...backgroundBundleConfig,
    });

    await build({
      entrypoints: ["./src/offscreen/offscreen.ts"],
      outdir: `./${OUT_DIR}/offscreen`,
      target: "browser",
      ...offscreenBundleConfig,
    });

    // Dev page: replay Innertube metadata + profile scoring (same shared modules as `/watch`).
    await mkdir(join(OUT_DIR, "test-bench"), { recursive: true });
    await build({
      entrypoints: ["./src/test-bench/index.ts"],
      outdir: `./${OUT_DIR}/test-bench`,
      target: "browser",
      ...testBenchBundleConfig,
    });

    // Build popup
    await build({
      entrypoints: ["./src/popup/index.tsx"],
      outdir: `./${OUT_DIR}/popup`,
      ...defaultBundleConfig,
    });

    // Copy static files
    await copyStaticFiles();

    console.log("Build completed successfully!");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

buildExtension();

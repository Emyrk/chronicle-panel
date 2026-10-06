import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const [entry, outfile] of [
  ["src/panel.ts", "dist/panel.js"],
  ["src/worker.ts", "dist/worker.js"],
]) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    minify: false,
    legalComments: "none",
  });
}

await cp("src/panel.css", "dist/panel.css");

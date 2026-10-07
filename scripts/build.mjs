import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const manifestPath = "chronicle-panel.json";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const [entry, outfile] of [
  ["src/panel.ts", "dist/panel.js"],
  ["src/worker.ts", "dist/worker.js"],
]) {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    minify: false,
    legalComments: "none",
    metafile: true,
  });

  const unresolvedImports = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((imported) => imported.external),
  );
  if (unresolvedImports.length > 0) {
    throw new Error(
      `${outfile} is not self-contained: ${unresolvedImports.map((imported) => imported.path).join(", ")}`,
    );
  }
}

await cp("src/panel.css", "dist/panel.css");
const styles = await readFile("dist/panel.css", "utf8");
if (/@import\b|url\s*\(/i.test(styles)) {
  throw new Error("dist/panel.css is not self-contained: external CSS references are not allowed");
}

const manifestSource = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
for (const [name, artifact] of Object.entries(manifest.artifacts)) {
  if (typeof artifact !== "object" || artifact === null || typeof artifact.path !== "string") {
    throw new Error(`artifacts.${name} must contain a path`);
  }
  if (
    artifact.path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(artifact.path) ||
    artifact.path.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`artifacts.${name}.path must be repository-relative`);
  }

  const bytes = await readFile(artifact.path);
  manifest.artifacts[name] = {
    ...artifact,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

const artifactsProperty = '"artifacts"';
const artifactsPropertyIndex = manifestSource.indexOf(artifactsProperty);
const artifactsStart = manifestSource.indexOf("{", artifactsPropertyIndex + artifactsProperty.length);
let artifactsEnd = artifactsStart;
let depth = 0;
let inString = false;
let escaped = false;
for (; artifactsEnd < manifestSource.length; artifactsEnd += 1) {
  const character = manifestSource[artifactsEnd];
  if (inString) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') inString = false;
    continue;
  }
  if (character === '"') inString = true;
  else if (character === "{") depth += 1;
  else if (character === "}" && --depth === 0) break;
}
if (artifactsPropertyIndex < 0 || artifactsStart < 0 || depth !== 0) {
  throw new Error("Could not locate the artifacts object in chronicle-panel.json");
}

const artifactsJSON = JSON.stringify(manifest.artifacts, null, 2).replaceAll("\n", "\n  ");
const updatedManifest =
  manifestSource.slice(0, artifactsStart) + artifactsJSON + manifestSource.slice(artifactsEnd + 1);
await writeFile(manifestPath, updatedManifest);

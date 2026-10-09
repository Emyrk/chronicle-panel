import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { extname, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CONFIG_PATH = ".chronicle-panel-dev.json";
export const DISCOVERY_URL = "https://legacy.chronicleclassic.com/api/v1/discovery";
export const DEV_ROUTE_PREFIX = "/__chronicle-panel";
export const RAW_ARTIFACT_PREFIX = "https://raw.githubusercontent.com/__chronicle_panel_dev__/local/";

const DEFAULT_PORT = 4173;
const MANIFEST_PATH = "chronicle-panel.json";
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

export function canonicalizeJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot contain ${typeof value} values.`);
}

export function normalizeSite(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Chronicle sites must use HTTPS.");
  if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Chronicle site must be an HTTPS origin without a path, query, credentials, or port.");
  }
  if (url.hostname !== "chronicleclassic.com" && !url.hostname.endsWith(".chronicleclassic.com")) {
    throw new Error("Chronicle site must be hosted on chronicleclassic.com.");
  }
  return url.origin;
}

export function parseArguments(argv) {
  const options = { port: DEFAULT_PORT, site: null, chooseSite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--choose-site") {
      options.chooseSite = true;
      continue;
    }
    if (argument === "--site" || argument === "--port") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--site") options.site = normalizeSite(value);
      else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535.");
        options.port = port;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function createCustomPanelSettings(manifest, now = new Date().toISOString()) {
  const repository = manifest.plugin?.id?.startsWith("github:")
    ? manifest.plugin.id.slice("github:".length)
    : null;
  if (!repository || repository.split("/").length !== 2) {
    throw new Error("manifest plugin.id must use github:owner/repository for development side-loading.");
  }
  const manifestSha256 = createHash("sha256").update(canonicalizeJson(manifest)).digest("hex");
  const commitSha = manifestSha256.slice(0, 40);
  const artifacts = Object.fromEntries(Object.entries(manifest.artifacts).map(([name, artifact]) => [
    name,
    {
      url: `${RAW_ARTIFACT_PREFIX}${commitSha}/${artifact.path}`,
      sha256: artifact.sha256,
      size: artifact.size,
    },
  ]));
  return {
    enabled: true,
    installations: [{
      repository,
      commitSha,
      installedRef: "local-dev",
      manifest,
      manifestSha256,
      artifacts,
      enabled: true,
      installedAt: now,
      updatedAt: now,
    }],
    revision: 1,
    updated_at: now,
  };
}

export function rewriteLocation(location, upstreamOrigin, localOrigin) {
  if (!location) return location;
  if (location.startsWith(upstreamOrigin)) return localOrigin + location.slice(upstreamOrigin.length);
  return location;
}

export function rewriteSetCookie(cookie, upstreamHostname) {
  return cookie
    .replace(new RegExp(`;\\s*Domain=?\\.?${upstreamHostname.replaceAll(".", "\\.")}`, "ig"), "")
    .replace(/;\s*Secure/ig, "");
}

export function injectDevBootstrap(html) {
  const script = `<script data-chronicle-panel-dev>\n(() => {\n  const nativeFetch = window.fetch.bind(window);\n  const rawPrefix = ${JSON.stringify(RAW_ARTIFACT_PREFIX)};\n  window.fetch = (input, init) => {\n    const original = input instanceof Request ? input.url : String(input);\n    if (!original.startsWith(rawPrefix)) return nativeFetch(input, init);\n    const slash = original.indexOf('/', rawPrefix.length);\n    if (slash === -1) return nativeFetch(input, init);\n    const localUrl = ${JSON.stringify(`${DEV_ROUTE_PREFIX}/artifacts/`)} + original.slice(slash + 1);\n    return nativeFetch(input instanceof Request ? new Request(localUrl, input) : localUrl, init);\n  };\n  const events = new EventSource(${JSON.stringify(`${DEV_ROUTE_PREFIX}/events`)});\n  events.addEventListener('built', () => window.location.reload());\n})();\n</script>`;
  const marker = "</head>";
  const index = html.toLowerCase().indexOf(marker);
  return index === -1 ? `${script}\n${html}` : `${html.slice(0, index)}${script}\n${html.slice(index)}`;
}

export function renderSiteChooser(sites, errorMessage = "") {
  const cards = sites.map((site) => {
    const name = escapeHtml(site.branding?.display_name || new URL(site.url).hostname);
    const tagline = escapeHtml(site.branding?.tagline || "");
    const logo = site.branding?.square_logo
      ? `<img src="${escapeAttribute(site.branding.square_logo)}" alt="" loading="lazy">`
      : "";
    return `<button name="site" value="${escapeAttribute(site.url)}">${logo}<span><strong>${name}</strong><small>${tagline}</small><code>${escapeHtml(site.url)}</code></span></button>`;
  }).join("\n");
  const error = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Choose a Chronicle site</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111;color:#eee}body{max-width:900px;margin:0 auto;padding:32px 20px}h1{margin-bottom:8px}p{color:#aaa}.error{color:#ff9b8f}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}button{display:flex;gap:12px;text-align:left;align-items:center;background:#1c1c1c;color:inherit;border:1px solid #333;border-radius:10px;padding:14px;cursor:pointer}button:hover{border-color:#e8a82e;background:#242018}img{width:48px;height:48px;object-fit:cover;border-radius:8px}span{min-width:0;display:grid;gap:3px}small,code{color:#aaa;overflow:hidden;text-overflow:ellipsis}code{font-size:11px}</style></head><body><h1>Choose a Chronicle site</h1><p>The selection is saved in <code>${CONFIG_PATH}</code>. Reopen this screen later with <code>pnpm dev -- --choose-site</code>.</p>${error}<form method="post" action="${DEV_ROUTE_PREFIX}/select-site"><div class="grid">${cards}</div></form></body></html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

export async function fetchDiscovery(fetchImpl = fetch) {
  const response = await fetchImpl(DISCOVERY_URL, {
    headers: {
      Accept: "application/json",
      Origin: "https://chronicleclassic.com",
      Referer: "https://chronicleclassic.com/",
      "User-Agent": "Mozilla/5.0 Chronicle-Panel-Dev-Proxy",
    },
  });
  if (!response.ok) throw new Error(`Discovery request failed (${response.status}).`);
  const sites = await response.json();
  if (!Array.isArray(sites)) throw new Error("Discovery returned an invalid response.");
  return sites.map((site) => ({ ...site, url: normalizeSite(site.url) }));
}

async function readConfig() {
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    return { site: normalizeSite(config.site) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.warn(`Ignoring invalid ${CONFIG_PATH}: ${error.message}`);
    return null;
  }
}

async function saveConfig(site) {
  await writeFile(CONFIG_PATH, `${JSON.stringify({ site }, null, 2)}\n`);
}

async function buildPanelArtifacts() {
  await execFileAsync(process.execPath, ["scripts/build.mjs"]);
}

async function readManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  response.end(html);
}

async function readRequestBody(request, limit = 16 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function copyProxyHeaders(headers, upstream, localOrigin) {
  const copied = { ...headers };
  delete copied.host;
  delete copied.connection;
  delete copied["content-length"];
  copied.host = upstream.host;
  copied["accept-encoding"] = "identity";
  if (copied.origin) copied.origin = upstream.origin;
  if (copied.referer) copied.referer = copied.referer.replace(localOrigin, upstream.origin);
  return copied;
}

function proxyRequest(request, response, upstream, localOrigin) {
  const target = new URL(request.url, upstream);
  const client = target.protocol === "https:" ? https : http;
  const proxy = client.request(target, {
    method: request.method,
    headers: copyProxyHeaders(request.headers, upstream, localOrigin),
  }, (upstreamResponse) => {
    const headers = { ...upstreamResponse.headers };
    delete headers["content-length"];
    delete headers["content-encoding"];
    delete headers["transfer-encoding"];
    if (headers.location) {
      headers.location = rewriteLocation(headers.location, upstream.origin, localOrigin);
    } else {
      delete headers.location;
    }
    if (Array.isArray(headers["set-cookie"])) {
      headers["set-cookie"] = headers["set-cookie"].map((cookie) => rewriteSetCookie(cookie, upstream.hostname));
    }
    const contentType = String(headers["content-type"] || "");
    if (!contentType.includes("text/html")) {
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      upstreamResponse.pipe(response);
      return;
    }
    const chunks = [];
    upstreamResponse.on("data", (chunk) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      const body = injectDevBootstrap(Buffer.concat(chunks).toString("utf8"));
      headers["content-length"] = Buffer.byteLength(body);
      response.writeHead(upstreamResponse.statusCode || 502, headers);
      response.end(body);
    });
  });
  proxy.on("error", (error) => {
    if (!response.headersSent) sendHtml(response, 502, `<h1>Proxy error</h1><pre>${escapeHtml(error.message)}</pre>`);
    else response.destroy(error);
  });
  request.pipe(proxy);
}

function createSourceWatcher(onChange) {
  let timer = null;
  const watcher = watch("src", { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 80);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

export async function startDevProxy({ port = DEFAULT_PORT, initialSite = null, chooseSite = false } = {}) {
  let selectedSite = chooseSite ? null : initialSite ?? (await readConfig())?.site ?? null;
  let discovery = [];
  let discoveryError = "";
  const eventClients = new Set();
  let building = false;
  let rebuildPending = false;

  try {
    discovery = await fetchDiscovery();
  } catch (error) {
    discoveryError = error.message;
    console.warn(`Could not load Chronicle discovery: ${error.message}`);
  }

  await buildPanelArtifacts();

  const rebuild = async () => {
    if (building) {
      rebuildPending = true;
      return;
    }
    building = true;
    try {
      await buildPanelArtifacts();
      console.log(`[panel-dev] rebuilt at ${new Date().toLocaleTimeString()}`);
      for (const client of eventClients) client.write("event: built\ndata: {}\n\n");
    } catch (error) {
      console.error("[panel-dev] build failed", error);
    } finally {
      building = false;
      if (rebuildPending) {
        rebuildPending = false;
        void rebuild();
      }
    }
  };

  const server = http.createServer(async (request, response) => {
    try {
      const localOrigin = `http://${request.headers.host || `localhost:${port}`}`;
      const requestUrl = new URL(request.url, localOrigin);

      if (requestUrl.pathname === `${DEV_ROUTE_PREFIX}/health`) {
        sendJson(response, 200, { ok: true, site: selectedSite });
        return;
      }
      if (requestUrl.pathname === `${DEV_ROUTE_PREFIX}/events`) {
        response.writeHead(200, {
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream",
        });
        response.write(": connected\n\n");
        eventClients.add(response);
        request.on("close", () => eventClients.delete(response));
        return;
      }
      if (requestUrl.pathname === `${DEV_ROUTE_PREFIX}/choose-site`) {
        sendHtml(response, 200, renderSiteChooser(discovery, discoveryError));
        return;
      }
      if (requestUrl.pathname === `${DEV_ROUTE_PREFIX}/select-site` && request.method === "POST") {
        const params = new URLSearchParams(await readRequestBody(request));
        const nextSite = normalizeSite(params.get("site") || "");
        if (discovery.length > 0 && !discovery.some((site) => site.url === nextSite)) {
          throw new Error("Choose a site returned by Chronicle discovery.");
        }
        selectedSite = nextSite;
        await saveConfig(nextSite);
        response.writeHead(303, { Location: "/" });
        response.end();
        console.log(`[panel-dev] proxying ${nextSite}`);
        return;
      }
      if (!selectedSite) {
        sendHtml(response, 200, renderSiteChooser(discovery, discoveryError));
        return;
      }
      if (
        requestUrl.pathname === "/api/v1/me/custom-panels" &&
        (request.method === "GET" || request.method === "PUT")
      ) {
        if (request.method === "PUT") await readRequestBody(request, 2 * 1024 * 1024);
        sendJson(response, 200, createCustomPanelSettings(await readManifest()));
        return;
      }
      if (requestUrl.pathname.startsWith(`${DEV_ROUTE_PREFIX}/artifacts/`)) {
        const artifactPath = decodeURIComponent(requestUrl.pathname.slice(`${DEV_ROUTE_PREFIX}/artifacts/`.length));
        const manifest = await readManifest();
        const artifact = Object.values(manifest.artifacts).find((candidate) => candidate.path === artifactPath);
        if (!artifact) {
          sendJson(response, 404, { error: "Unknown panel artifact." });
          return;
        }
        const absolutePath = resolve(artifact.path);
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": MIME_TYPES.get(extname(absolutePath)) || "application/octet-stream",
          "Content-Length": artifact.size,
        });
        createReadStream(absolutePath).pipe(response);
        return;
      }
      proxyRequest(request, response, new URL(selectedSite), localOrigin);
    } catch (error) {
      sendHtml(response, 400, `<h1>Development proxy error</h1><pre>${escapeHtml(error.message)}</pre>`);
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  const localUrl = `http://localhost:${port}`;
  console.log(`[panel-dev] ${selectedSite ? `proxying ${selectedSite}` : "choose a site"}`);
  console.log(`[panel-dev] open ${selectedSite ? localUrl : `${localUrl}${DEV_ROUTE_PREFIX}/choose-site`}`);

  const stopWatching = createSourceWatcher(() => void rebuild());
  const close = async () => {
    stopWatching();
    for (const client of eventClients) client.end();
    await new Promise((resolveClose) => server.close(resolveClose));
  };
  return { server, close, get selectedSite() { return selectedSite; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseArguments(process.argv.slice(2));
  if (options.site) await saveConfig(options.site);
  const proxy = await startDevProxy({
    port: options.port,
    initialSite: options.site,
    chooseSite: options.chooseSite,
  });
  const shutdown = async () => {
    await proxy.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  RAW_ARTIFACT_PREFIX,
  canonicalizeJson,
  createCustomPanelSettings,
  injectDevBootstrap,
  normalizeSite,
  parseArguments,
  proxyRequest,
  rewriteLocation,
  rewriteSetCookie,
} from "./dev-proxy.mjs";

const manifest = {
  schema_version: 1,
  plugin: {
    id: "github:emyrk/chronicle-panel",
    name: "Panels",
    version: "1.0.0",
  },
  host: { api_version: 1 },
  artifacts: {
    entry: { path: "dist/panel.js", sha256: "a".repeat(64), size: 12 },
    styles: { path: "dist/panel.css", sha256: "b".repeat(64), size: 8 },
  },
  panels: [{ id: "example", name: "Example", streams: [] }],
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

describe("canonicalizeJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalizeJson({ z: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"z":1}');
  });
});

describe("createCustomPanelSettings", () => {
  it("creates a Chronicle-compatible local installation", () => {
    const settings = createCustomPanelSettings(manifest, "2026-10-09T00:00:00.000Z");
    const installation = settings.installations[0];
    expect(settings.enabled).toBe(true);
    expect(installation.repository).toBe("emyrk/chronicle-panel");
    expect(installation.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(installation.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(installation.artifacts.entry.url).toBe(
      `${RAW_ARTIFACT_PREFIX}${installation.commitSha}/dist/panel.js`,
    );
  });
});

describe("normalizeSite", () => {
  it("accepts Chronicle origins and removes a trailing slash", () => {
    expect(normalizeSite("https://octo.chronicleclassic.com/")).toBe("https://octo.chronicleclassic.com");
  });

  it("rejects unrelated hosts and paths", () => {
    expect(() => normalizeSite("https://example.com")).toThrow(/chronicleclassic/);
    expect(() => normalizeSite("https://octo.chronicleclassic.com/reports")).toThrow(/origin/);
  });
});

describe("parseArguments", () => {
  it("parses site, port, and chooser flags", () => {
    expect(parseArguments(["--", "--site", "https://octo.chronicleclassic.com", "--port", "5000", "--choose-site"])).toEqual({
      site: "https://octo.chronicleclassic.com",
      port: 5000,
      chooseSite: true,
    });
  });
});

describe("proxy response rewriting", () => {
  it("keeps navigation on the local proxy", () => {
    expect(rewriteLocation(
      "https://octo.chronicleclassic.com/login?from=%2Ffoo",
      "https://octo.chronicleclassic.com",
      "http://localhost:4173",
    )).toBe("http://localhost:4173/login?from=%2Ffoo");
  });

  it("leaves relative redirects on the local proxy", () => {
    expect(rewriteLocation("/login", "https://octo.chronicleclassic.com", "http://localhost:4173")).toBe("/login");
  });

  it("makes upstream cookies usable on the HTTP localhost proxy", () => {
    expect(rewriteSetCookie(
      "session=value; Path=/; Domain=.octo.chronicleclassic.com; Secure; HttpOnly",
      "octo.chronicleclassic.com",
    )).toBe("session=value; Path=/; HttpOnly");
  });
});

describe("proxyRequest", () => {
  it("streams non-HTML bytes unchanged and injects only HTML", async () => {
    const binary = Buffer.from([0, 255, 1, 128, 2]);
    const upstream = createServer((request, response) => {
      if (request.url === "/data") {
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        response.end(binary);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><head></head><body>ok</body></html>");
    });
    const upstreamOrigin = await listen(upstream);
    const proxy = createServer((request, response) => {
      proxyRequest(request, response, new URL(upstreamOrigin), "http://localhost");
    });
    const proxyOrigin = await listen(proxy);
    try {
      const data = Buffer.from(await (await fetch(`${proxyOrigin}/data`)).arrayBuffer());
      expect(data).toEqual(binary);
      const html = await (await fetch(`${proxyOrigin}/`)).text();
      expect(html).toContain("data-chronicle-panel-dev");
      expect(html).toContain("<body>ok</body>");
    } finally {
      await close(proxy);
      await close(upstream);
    }
  });
});

describe("injectDevBootstrap", () => {
  it("injects artifact rewriting and live reload before the head closes", () => {
    const html = injectDevBootstrap("<html><head><title>x</title></head><body></body></html>");
    expect(html).toContain("data-chronicle-panel-dev");
    expect(html).toContain(RAW_ARTIFACT_PREFIX);
    expect(html.indexOf("data-chronicle-panel-dev")).toBeLessThan(html.indexOf("</head>"));
  });
});

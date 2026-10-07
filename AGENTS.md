# Chronicle custom panel library

This repository is both a working multi-panel plugin and the canonical agent-oriented example for authoring Chronicle custom panels.

## Start here

Before changing a panel:

1. Read `.claude/skills/chronicle-custom-panels/SKILL.md`.
2. Read `chronicle-panel.json` and identify the panel ID and declared streams.
3. Use `@emyrk/chronicle-panel-sdk/v1` for the exact host contract.
4. Use the SDK's `/v1/events` and `/v1/protobuf` exports for stream decoding.
5. Read both `src/panel.ts` and `src/worker.ts`. One library entry serves every panel in the manifest.

## Architecture

- `chronicle-panel.json` declares a library containing one or more panels.
- `src/panel.ts` is bundled to one self-contained ES module. Its default export implements Chronicle host API v1.
- Chronicle calls `mount()` once for each visible panel instance and passes the selected `panelId`.
- `src/worker.ts` is a shared optional worker bundle. `api.workers.create()` creates one worker owned by that mounted panel.
- `api.events.getStream()` returns a copied, decompressed Chronicle binary stream. Transfer it to the worker.
- `update()` receives encounter/entity selection, replay, theme, option, and size changes.
- `destroy()` must release every resource created by `mount()`.
- Styles run inside a ShadowRoot. Use CSS variables and DOM APIs, not Chronicle's private React/Tailwind implementation.
- `api.breakouts.open()` creates a Chronicle-owned floating shell and returns a second isolated ShadowRoot for plugin content.

## Hard rules

- Treat the plugin as trusted code, but keep its behavior scoped to its ShadowRoot.
- Do not access Chronicle private modules, React contexts, authentication storage, or internal endpoints.
- Do not execute work at module import time beyond defining functions and constants.
- Do not request a stream not declared by the selected manifest panel.
- Do not mutate or retain a reference to host snapshot objects.
- Do not process large event streams on the main thread.
- Do not create your own worker URL. Use `api.workers.create()` so Chronicle can terminate it.
- Do not request streams again for replay ticks or ordinary `update()` calls.
- Do not assume one mount. Multiple instances of one panel can exist simultaneously.
- Do not create unmanaged document-level floating UI. Use `api.breakouts.open()` so Chronicle owns placement, dragging, resizing, mobile presentation, and popup behavior.
- Do not open more than eight breakouts per mounted panel or use titles longer than 100 characters.
- Close breakout handles during `destroy()`; `close()` is idempotent and Chronicle also closes remaining handles during host teardown.
- Do not leave timers, listeners, observers, workers, breakouts, or large buffers alive after `destroy()`.
- Keep `entry`, optional `worker`, and optional `styles` self-contained with no unresolved runtime-relative imports or asset references.
- Treat each manifest artifact as `{ "path", "sha256", "size" }`. Digests are lowercase SHA-256 of the exact built bytes, and sizes are exact byte lengths.
- Run `pnpm build` to refresh artifact digests and sizes, then commit `chronicle-panel.json` and `dist/` together after every source change intended for installation.

## Canonical data sources

- Host API types: `@emyrk/chronicle-panel-sdk/v1`
- Stream framing decoder: `@emyrk/chronicle-panel-sdk/v1/events`
- Generated protobuf schemas: `@emyrk/chronicle-panel-sdk/v1/protobuf`
- Canonical protobuf source: `@emyrk/chronicle-panel-sdk/proto/chronicle.proto`

When Chronicle's public panel contract or event schema changes, update the SDK dependency, review its release notes and type errors, then run all validation and rebuild the artifacts.

## Floating breakouts

Use the host API when a detail view should float above the panel:

```ts
const breakout = api.breakouts.open({
  title: "Damage details",
  initialPosition: { x: 200, y: 120 },
  initialSize: { width: 420, height: 320 },
});

const content = breakout.root.host.ownerDocument.createElement("div");
breakout.root.append(content);
```

- Chronicle owns the shell, close control, desktop dragging/resizing, mobile modal presentation, popup portal, z-index, and viewport clamping.
- The plugin owns only the DOM inside `breakout.root`. The verified plugin stylesheet is injected into each breakout ShadowRoot.
- Keep the returned handle in mount-local state and call `breakout.close()` during cleanup. Use `api.breakouts.closeAll()` only when intentionally closing every breakout opened by that mounted panel.
- Use `breakout.root.host.ownerDocument` for DOM creation and `.defaultView` for owner-window APIs; do not assume the global `window` or `document` belongs to the panel.
- The API requires `@emyrk/chronicle-panel-sdk` 0.2.0 or newer.

## Game-data lookups

- Event streams omit static metadata such as item quality.
- Use `api.gameData.getItemMetadata(itemIds)`; never call Chronicle's private `/internal/gamedata` routes directly.
- Collect and deduplicate IDs in the worker, then make one bounded host request.
- Return metadata to the worker for aggregation rather than processing large equipment payloads on the main thread.

## Entity classification

- Player-only lookups are insufficient for pets, guardians, charms, and vehicles.
- Panels that attribute unit activity should declare `unit_classification` alongside the activity stream.
- Merge classification and activity messages by encounter and `EventMeta.index` in the worker.
- Resolve the current `controller` or `owner` first, then fall back to `snapshot.instance.units[guid].owner`.
- Keep this temporal state worker-local; Chronicle does not expose its private classifier object through the host API.

## Adding a panel

1. Choose a stable lowercase ID matching `[a-z0-9._-]+`.
2. Add its metadata and minimal stream list to `chronicle-panel.json`.
3. Add a view branch keyed by `request.panelId` in `src/panel.ts`.
4. Add worker initialization and result messages in `src/worker.ts`.
5. Decode using the schema matching the declared stream.
6. Aggregate by encounter so selection changes do not require another stream request.
7. Decide replay behavior:
   - Incremental presentation: filter a precomputed timestamp index.
   - Full presentation: ignore the replay timestamp.
   - Never decode the stream on every replay update.
8. Implement deterministic cleanup.
9. Add tests for helpers and worker aggregation.
10. Run `pnpm check`, `pnpm test`, and `pnpm build`.
11. Review the generated `dist/` artifacts and refreshed manifest digests and sizes.
12. Commit `chronicle-panel.json` and `dist/` together.

## Validation

Required before committing:

```bash
pnpm check
pnpm test
pnpm build
```

Inspect `dist/panel.js` and `dist/worker.js` for unexpected external imports. Chronicle requires self-contained artifact files.

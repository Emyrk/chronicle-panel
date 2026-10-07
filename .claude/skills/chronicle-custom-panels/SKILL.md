---
name: chronicle-custom-panels
description: Build, extend, debug, and document trusted Chronicle custom panel libraries. Use whenever adding a panel, changing event decoding, handling replay updates, editing chronicle-panel.json, or preparing installable dist artifacts.
---

# Chronicle custom panels

## Objective

Produce a panel that is correct for Chronicle host API v1, fast on large combat logs, replay-aware where appropriate, independently mountable, and completely cleaned up on unmount.

## Required reading

Read these files before editing:

1. `AGENTS.md`
2. `chronicle-panel.json`
3. The host contract from `@emyrk/chronicle-panel-sdk/v1`
4. The framing decoder and schemas from the SDK's `/v1/events` and `/v1/protobuf` exports
5. `src/panel.ts`
6. `src/worker.ts`

## Mental model

A repository is a library, not one panel. Chronicle resolves the repository to an immutable Git SHA, reads one manifest, and offers each `panels[]` entry separately. All panels share the bundled artifacts. The selected manifest ID arrives as `request.panelId`.

Chronicle owns:

- Panel card and selector
- Installation and immutable artifact loading
- Event-stream network cache and decompression
- Host snapshot production
- Plugin worker lifecycle tracking
- Floating breakout shells, popup placement, dragging/resizing, mobile presentation, and viewport bounds
- Cleanup fallback and error presentation

The plugin owns:

- DOM inside its ShadowRoot
- Its worker protocol
- Stream decoding and aggregation
- Its rendering cost
- DOM rendered inside any breakout ShadowRoots it opens
- Cheap reaction to replay and selection updates
- Cleanup of everything it creates

## Add a panel

### 1. Manifest

Add a `panels[]` item:

```json
{
  "id": "my-panel",
  "name": "My Panel",
  "description": "What the panel shows",
  "streams": ["damage"],
  "worker": true
}
```

Declare the minimum streams. The host rejects undeclared requests.

### 2. View lifecycle

In `src/panel.ts`, route using `request.panelId`. Create all mutable state inside `mount()`, never at module scope. Return `update()` and `destroy()`.

Use `request.root` for DOM. For owner-window objects use `request.root.host.ownerDocument.defaultView`.

### 3. Floating breakouts

Use `api.breakouts.open()` for floating detail views instead of creating fixed document-level UI:

```ts
const breakout = api.breakouts.open({
  title: "Player details",
  initialPosition: { x: 200, y: 120 },
  initialSize: { width: 420, height: 320 },
});

const content = breakout.root.host.ownerDocument.createElement("div");
breakout.root.append(content);
```

Chronicle owns the shell, close control, desktop drag/resize behavior, mobile modal, popup portal, z-index, and viewport clamping. Render only into the returned isolated ShadowRoot. The verified plugin stylesheet is injected there automatically.

Keep handles in mount-local state. `close()` is idempotent; call it during cleanup, or use `api.breakouts.closeAll()` to close every breakout owned by that mounted panel. Chronicle enforces eight simultaneous breakouts per mount and 100-character titles. Use `breakout.root.host.ownerDocument` for DOM creation and its `.defaultView` for owner-window APIs, not global `window` or `document`.

This API requires `@emyrk/chronicle-panel-sdk` 0.2.0 or newer.

### 4. Fetch once

```ts
const stream = await api.events.getStream("damage");
```

Check `api.lifecycle.signal.aborted` after awaits. The returned buffer is owned by this mount.

### 5. Worker processing

```ts
const worker = api.workers.create();
worker.postMessage({ data: stream.data }, [stream.data]);
```

Decode and aggregate in `src/worker.ts`. Prefer compact per-encounter aggregates so encounter selection can change without fetching or decoding again.

### 6. Protobuf selection

Map stream names to schemas exported by `@emyrk/chronicle-panel-sdk/v1/protobuf`. Examples:

- `damage` → `Damage`
- `heal` → `Heal`
- `resource_change` → `ResourceChange`
- `cast` → `Cast`
- `aura` → `Aura`
- `spell_go` → `SpellGo`
- `spell_start` → `SpellStart`
- `spell_fail` → `SpellFail`
- `dispel` → `Dispel`
- `interrupt` → `Interrupt`

Import generated schemas from `@emyrk/chronicle-panel-sdk/v1/protobuf` and `decodeEncounterPayloads()` from `@emyrk/chronicle-panel-sdk/v1/events`.

### 7. Static game data

Combat streams intentionally omit static metadata such as item names and rarity. Use host-mediated methods instead of private Chronicle routes:

```ts
const items = await api.gameData.getItemMetadata(itemIds);
```

Collect unique positive IDs in the worker, request them as one bounded batch, then send the returned metadata back to the worker. Do not issue one request per gear slot.

### 8. Pets and controlled units

A caster GUID may identify a pet, guardian, charmed unit, or vehicle rather than a player. For owner-attributed metrics, declare `unit_classification` alongside the activity stream and decode it with `UnitClassificationSchema`.

Merge classification and activity events per encounter by `EventMeta.index`. Track the latest `controller` or `owner` for each target, then fall back to `snapshot.instance.units[target].owner` when no temporal classification exists. Do not rely only on `snapshot.instance.players[caster]`, and do not import Chronicle's private classifier.

### 9. Replay

`snapshot.sync.timestampMs` is an absolute Unix timestamp.

Choose explicitly:

- Full-data view: render all aggregate data and ignore timestamp changes.
- Replay-following view: precompute timestamp-sorted rows or intervals once, then filter or binary-search on updates.

Never fetch or decode a stream on every replay update. Chronicle may update the timestamp frequently during playback.

### 10. Selection

When `snapshot.selection.encounterIds` changes, send only the new IDs to the worker. Reuse per-encounter aggregates. Player/enemy selection can be treated similarly if the panel supports it.

### 11. Cleanup

`destroy()` must be idempotent in effect. It must stop worker activity, close breakout handles, detach listeners, cancel timers/animation frames, disconnect observers, release references, and remove plugin DOM. Chronicle also terminates the host-managed worker and closes remaining breakouts as fallbacks, but the plugin must still clean up correctly.

## Stream framing

`chronicle-event-stream-v1` contains concatenated encounter payloads. Each payload has an encounter ID, absolute first timestamp, event count, data length, and length-delimited protobuf messages. Use `decodeEncounterPayloads()` from `@emyrk/chronicle-panel-sdk/v1/events`; do not parse framing ad hoc in each panel.

`EventMeta.offsetMilli` is relative to the encounter payload's `firstTimestampMs`. Absolute event time is:

```ts
const atMs = payload.firstTimestampMs + Number(event.meta?.offsetMilli ?? 0n);
```

## Performance review

Before completion verify:

- No work occurs at module evaluation time.
- Each stream is requested once per mount.
- Buffers are transferred, not cloned again.
- Main-thread rendering receives compact results.
- Replay updates are presentation-only or use an index.
- Selection changes reuse decoded/aggregated data.
- No unbounded DOM list is rendered.
- Floating detail UI uses `api.breakouts.open()` and stays within the per-mount limit.
- Cleanup closes breakout handles and releases worker and large data.

## Build contract

Run:

```bash
pnpm check
pnpm test
pnpm build
```

The output must include:

```text
dist/panel.js
dist/worker.js
dist/panel.css
```

`panel.js` and `worker.js` must be independently self-contained ESM files. The stylesheet must not retain unresolved relative imports or asset references. `pnpm build` rejects external bundle imports, then rewrites every manifest artifact's lowercase SHA-256 digest and exact byte size from the final bytes. Review and commit `chronicle-panel.json` with `dist/`; never hand-edit digests or sizes.

## Updating the SDK

When Chronicle's public panel contract or protobuf schema changes:

1. Update `@emyrk/chronicle-panel-sdk` to the intended release.
2. Review the SDK release and resulting type errors.
3. Update panel and worker usage where required.
4. Run full validation and rebuild `dist/`.

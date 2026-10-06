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
3. `src/sdk/host.ts`
4. `src/sdk/stream.ts`
5. The relevant messages and enums in `proto/chronicle.proto`
6. `src/panel.ts`
7. `src/worker.ts`

## Mental model

A repository is a library, not one panel. Chronicle resolves the repository to an immutable Git SHA, reads one manifest, and offers each `panels[]` entry separately. All panels share the bundled artifacts. The selected manifest ID arrives as `request.panelId`.

Chronicle owns:

- Panel card and selector
- Installation and immutable artifact loading
- Event-stream network cache and decompression
- Host snapshot production
- Plugin worker lifecycle tracking
- Cleanup fallback and error presentation

The plugin owns:

- DOM inside its ShadowRoot
- Its worker protocol
- Stream decoding and aggregation
- Its rendering cost
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

### 3. Fetch once

```ts
const stream = await api.events.getStream("damage");
```

Check `api.lifecycle.signal.aborted` after awaits. The returned buffer is owned by this mount.

### 4. Worker processing

```ts
const worker = api.workers.create();
worker.postMessage({ data: stream.data }, [stream.data]);
```

Decode and aggregate in `src/worker.ts`. Prefer compact per-encounter aggregates so encounter selection can change without fetching or decoding again.

### 5. Protobuf selection

Map stream names to canonical messages in `proto/chronicle.proto`. Examples:

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

Use generated schemas from `src/generated/chronicle_pb.ts` with `decodeEncounterPayloads()`.

### 6. Pets and controlled units

A caster GUID may identify a pet, guardian, charmed unit, or vehicle rather than a player. For owner-attributed metrics, declare `unit_classification` alongside the activity stream and decode it with `UnitClassificationSchema`.

Merge classification and activity events per encounter by `EventMeta.index`. Track the latest `controller` or `owner` for each target, then fall back to `snapshot.instance.units[target].owner` when no temporal classification exists. Do not rely only on `snapshot.instance.players[caster]`, and do not import Chronicle's private classifier.

### 7. Replay

`snapshot.sync.timestampMs` is an absolute Unix timestamp.

Choose explicitly:

- Full-data view: render all aggregate data and ignore timestamp changes.
- Replay-following view: precompute timestamp-sorted rows or intervals once, then filter or binary-search on updates.

Never fetch or decode a stream on every replay update. Chronicle may update the timestamp frequently during playback.

### 8. Selection

When `snapshot.selection.encounterIds` changes, send only the new IDs to the worker. Reuse per-encounter aggregates. Player/enemy selection can be treated similarly if the panel supports it.

### 9. Cleanup

`destroy()` must be idempotent in effect. It must stop worker activity, detach listeners, cancel timers/animation frames, disconnect observers, release references, and remove plugin DOM. Chronicle also terminates the host-managed worker as a fallback, but the plugin must still clean up correctly.

## Stream framing

`chronicle-event-stream-v1` contains concatenated encounter payloads. Each payload has an encounter ID, absolute first timestamp, event count, data length, and length-delimited protobuf messages. Use `src/sdk/stream.ts`; do not parse framing ad hoc in each panel.

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
- Cleanup releases worker and large data.

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

`panel.js` and `worker.js` must be independently self-contained ESM files. Do not leave relative import statements in either output.

## Updating schemas

When Chronicle's canonical proto changes:

1. Replace `proto/chronicle.proto` from Chronicle.
2. Run `buf generate` using `buf.gen.yaml`.
3. Review generated schema changes.
4. Update worker field usage and tests.
5. Run full validation and rebuild `dist/`.

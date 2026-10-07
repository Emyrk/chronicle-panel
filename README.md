# Chronicle custom panel examples

Reference implementation and authoring documentation for trusted custom JavaScript panels in [Chronicle](https://github.com/Emyrk/chronicle).

One repository is a **panel library**. This repository publishes three panels from one manifest and one bundled entry module:

| Panel ID | Streams | What it demonstrates |
|---|---|---|
| `damage-summary` | `damage`, `unit_classification` | Attribute pets through temporal ownership and increment totals as replay advances |
| `gear-rarity` | `combatant_info` | Decode equipment, request batched item quality metadata, and sort rarity counts |
| `replay-casts` | `spell_go` | Decode once, then follow Chronicle's replay timestamp without reprocessing |

Custom panels are trusted code. Installing one gives it access comparable to Chronicle's own frontend JavaScript.

## Repository contract

Chronicle reads [`chronicle-panel.json`](chronicle-panel.json) from the repository root at an immutable Git commit. The manifest describes the library, shared artifacts, and every panel it contains.

```text
chronicle-panel.json
├── plugin metadata
├── host API version
├── bundled entry, worker, and stylesheet
└── panels[]
    ├── stable panel ID
    ├── display metadata
    └── declared event streams
```

Each artifact is an object containing its repository-relative `path`, lowercase SHA-256 digest, and exact byte size:

```json
{
  "artifacts": {
    "entry": {
      "path": "dist/panel.js",
      "sha256": "<64 lowercase hex characters>",
      "size": 12345
    }
  }
}
```

`entry` is required. `worker` and `styles` are optional, but use the same object shape when present. Each release must commit both the built `dist/` artifacts and the refreshed `chronicle-panel.json` because Chronicle does not run package managers or build third-party repositories. `pnpm build` regenerates every artifact digest and size from the final file bytes.

## Quick start

```bash
pnpm install
pnpm check
pnpm test
pnpm build
git add chronicle-panel.json dist
```

During development, install a branch or commit through Chronicle's **Settings → Custom panels** UI. Chronicle resolves it to an immutable SHA before execution.

## Important files

```text
chronicle-panel.json                 Library and panel declarations
src/panel.ts                         Browser view entry and lifecycle
src/gearRarity.ts                    Gear snapshot, rarity aggregation, and sorting helpers
src/worker.ts                        Shared worker aggregation for all example panels
src/panel.css                        Shadow DOM styles
src/sdk/host.ts                      Chronicle host API v1 contract
src/sdk/stream.ts                    chronicle-event-stream-v1 framing decoder
src/generated/chronicle_pb.ts        Generated protobuf schemas
proto/chronicle.proto                Snapshot of the canonical event schema
.claude/skills/chronicle-custom-panels/SKILL.md
AGENTS.md                             Agent-first authoring guide
```

## Add another panel to this library

1. Add a unique entry to `panels` in `chronicle-panel.json`.
2. Declare only the streams that panel may request.
3. Branch on `request.panelId` in `src/panel.ts`.
4. Add worker processing in `src/worker.ts`, or omit `worker: true` if it needs none.
5. Ensure every listener, timer, observer, stream reference, and worker is released by `destroy()`.
6. Run `pnpm check && pnpm test && pnpm build`.
7. Verify `chronicle-panel.json` contains the rebuilt artifacts' SHA-256 digests and byte sizes.
8. Commit the updated manifest and `dist/` output together.

A library uses one entry module and optional shared worker/style artifacts. The host passes the selected `panelId` to `mount()`.

## Lifecycle

```ts
const plugin = {
  apiVersion: 1,
  async mount({ panelId, root, api, snapshot }) {
    // Build the view inside root.
    // Request only manifest-declared streams.
    // Use api.workers.create() for the manifest worker.

    return {
      update(nextSnapshot) {
        // Selection, replay, theme, resize, and option changes.
      },
      destroy() {
        // Release everything created by mount().
      },
    };
  },
};

export default plugin;
```

Chronicle can mount more than one instance of the same panel. Never use singleton mutable state for a mounted view.

## Event streams

`api.events.getStream(type)` returns an owned `ArrayBuffer` using `chronicle-event-stream-v1`. Chronicle already fetched, decompressed, and cached the source stream. The returned bytes are a copy that the plugin can transfer safely:

```ts
const stream = await api.events.getStream("damage");
const worker = api.workers.create();
worker.postMessage({ data: stream.data }, [stream.data]);
```

The framing for each concatenated encounter is:

```text
varint encounter ID byte length
UTF-8 encounter ID
varint first timestamp in Unix milliseconds
varint protobuf message count
varint total message-data byte length
repeated {
  varint protobuf message byte length
  protobuf message bytes
}
```

The protobuf message type is selected by the requested stream. The canonical schema is [`api/chronicleproto/chronicle.proto`](https://github.com/Emyrk/chronicle/blob/main/api/chronicleproto/chronicle.proto). This repository keeps a snapshot under `proto/` so the examples are buildable and inspectable in isolation.

Do not retain decoded event objects unnecessarily. Real logs are large. Aggregate while decoding, or build compact per-encounter indexes as the examples do.

## Pets and temporal ownership

Pet ownership can change during an encounter through charms, vehicles, or other control effects. Do not classify damage only from the static unit snapshot. Panels that attribute pet activity should declare both their activity stream and `unit_classification`, merge those events by `EventMeta.index`, and prefer the latest `controller` or `owner` before falling back to `snapshot.instance.units[guid].owner`.

The host intentionally exposes raw streams rather than Chronicle's private in-memory classifier. This keeps the plugin contract stable and lets the worker reproduce ownership at the exact point each event occurred.

## Game-data metadata

Event streams carry compact gameplay records. They do not duplicate static game data such as item names or quality. Use host-mediated game-data methods rather than Chronicle's private HTTP endpoints:

```ts
const items = await api.gameData.getItemMetadata(itemIds);
```

`getItemMetadata()` deduplicates a bounded batch of item IDs and returns only stable fields needed by plugins: `entry`, `name`, and numeric `quality`. Request metadata after collecting unique IDs in the worker, not once per equipped slot. The `gear-rarity` panel demonstrates the worker → host metadata request → worker aggregation flow.

## Replay and Sync Mode

`snapshot.sync` is presentation state:

```ts
{
  enabled: boolean;
  playing: boolean;
  timestampMs: number | null;
}
```

The `replay-casts` example decodes the full selected data once and filters the rendered result when `timestampMs` changes. The `damage-summary` example keeps a timestamp-sorted event index and advances an accumulator as replay moves forward, resetting it only for backward seeks or selection changes. Neither panel refetches or decodes streams on replay ticks.

Guidelines:

- Do not request streams again when replay advances.
- Do not rerun expensive aggregation on every replay tick if a sorted timestamp index can answer the view.
- Coalesce rendering if plugin work can exceed a frame.
- Treat a null timestamp as full-encounter presentation.

## Performance rules

A plugin only affects Chronicle while one of its panels is mounted. Plugin authors are responsible for the active panel's cost.

- Request each stream once per mounted panel.
- Transfer the owned buffer to the worker instead of cloning it again.
- Aggregate in the worker, not the main thread.
- Keep worker results compact.
- Use `update()` for cheap presentation changes.
- Terminate workers and release large references in `destroy()`.
- Do not create global timers, mutation observers, or document listeners at module evaluation time.
- Do not depend on Chronicle's React runtime or private source modules.

## Styling

The host mounts the view in a ShadowRoot and injects the optional stylesheet. Use inherited Chronicle CSS custom properties with fallbacks. Do not depend on Chronicle Tailwind class names.

Use `root.host.ownerDocument` rather than the global `document` when creating popup-aware UI. The same panel may render in Chronicle's separate panel window.

## Agent workflow

Agents should read, in order:

1. [`AGENTS.md`](AGENTS.md)
2. [`.claude/skills/chronicle-custom-panels/SKILL.md`](.claude/skills/chronicle-custom-panels/SKILL.md)
3. [`chronicle-panel.json`](chronicle-panel.json)
4. [`src/sdk/host.ts`](src/sdk/host.ts)
5. [`src/sdk/stream.ts`](src/sdk/stream.ts)
6. The relevant message in [`proto/chronicle.proto`](proto/chronicle.proto)
7. Existing `src/panel.ts` and `src/worker.ts` patterns

The skill contains a complete checklist for adding or changing a panel.

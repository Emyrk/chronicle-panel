/// <reference lib="webworker" />

import { DamageSchema, SpellGoSchema, UnitClassificationSchema } from "./generated/chronicle_pb";
import { DamageAccumulator, resolveDamageEvents, type DamageRow, type ResolvedDamageEvent } from "./damage";
import { decodeEncounterPayloads } from "./sdk/stream";

interface InitMessage {
  type: "init";
  panelId: string;
  streamType: "damage" | "spell_go";
  data: ArrayBuffer;
  classificationData?: ArrayBuffer;
  selectedEncounterIds: string[];
  players: Record<string, { name: string }>;
  units: Record<string, { name: string; owner?: string | null }>;
  sync: { enabled: boolean; timestampMs: number | null };
}

interface UpdateMessage {
  type: "update";
  selectedEncounterIds: string[];
  sync: { enabled: boolean; timestampMs: number | null };
}

type WorkerRequest = InitMessage | UpdateMessage | { type: "dispose" };
interface CastRow {
  encounterId: string;
  atMs: number;
  casterId: string;
  casterName: string;
  spellId: number | null;
  spellName: string;
  target: string | null;
}

let panelId = "";
let selected = new Set<string>();
let sync: InitMessage["sync"] = { enabled: false, timestampMs: null };
let damageEvents: ResolvedDamageEvent[] = [];
let damageAccumulator = new DamageAccumulator();
let casts: CastRow[] = [];

function publish(): void {
  if (panelId === "damage-summary") {
    const cutoff = sync.enabled ? sync.timestampMs : null;
    const rows: DamageRow[] = damageAccumulator.update(damageEvents, selected, cutoff);
    self.postMessage({ type: "damage-result", rows });
    return;
  }

  self.postMessage({
    type: "casts-result",
    rows: casts.filter((cast) => selected.has(cast.encounterId)),
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "dispose") {
    self.close();
    return;
  }
  if (message.type === "update") {
    selected = new Set(message.selectedEncounterIds);
    sync = message.sync;
    publish();
    return;
  }

  panelId = message.panelId;
  selected = new Set(message.selectedEncounterIds);
  sync = message.sync;

  if (message.streamType === "damage") {
    damageEvents = resolveDamageEvents(
      decodeEncounterPayloads(DamageSchema, message.data),
      message.classificationData
        ? decodeEncounterPayloads(UnitClassificationSchema, message.classificationData)
        : [],
      message.players,
      message.units,
    );
    damageAccumulator = new DamageAccumulator();
  } else {
    casts = [];
    for (const payload of decodeEncounterPayloads(SpellGoSchema, message.data)) {
      for (const cast of payload.events) {
        casts.push({
          encounterId: payload.encounterId,
          atMs: payload.firstTimestampMs + Number(cast.meta?.offsetMilli ?? 0n),
          casterId: cast.caster,
          casterName: message.players[cast.caster]?.name ?? cast.caster,
          spellId: cast.spellData?.id ?? null,
          spellName: cast.spellData?.name ?? "Unknown spell",
          target: cast.target ?? null,
        });
      }
    }
    casts.sort((a, b) => a.atMs - b.atMs);
  }

  publish();
};

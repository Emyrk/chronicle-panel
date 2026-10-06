/// <reference lib="webworker" />

import { DamageSchema, SpellGoSchema } from "./generated/chronicle_pb";
import { decodeEncounterPayloads } from "./sdk/stream";

interface InitMessage {
  type: "init";
  panelId: string;
  streamType: "damage" | "spell_go";
  data: ArrayBuffer;
  selectedEncounterIds: string[];
  players: Record<string, { name: string }>;
}

interface SelectionMessage {
  type: "selection";
  selectedEncounterIds: string[];
}

type WorkerRequest = InitMessage | SelectionMessage | { type: "dispose" };

type DamageEncounterTotals = Map<string, Map<string, number>>;
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
let damageByEncounter: DamageEncounterTotals = new Map();
let casts: CastRow[] = [];

function publish(): void {
  if (panelId === "damage-summary") {
    const totals = new Map<string, number>();
    for (const encounterId of selected) {
      for (const [name, amount] of damageByEncounter.get(encounterId) ?? []) {
        totals.set(name, (totals.get(name) ?? 0) + amount);
      }
    }
    const rows = [...totals.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
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
  if (message.type === "selection") {
    selected = new Set(message.selectedEncounterIds);
    publish();
    return;
  }

  panelId = message.panelId;
  selected = new Set(message.selectedEncounterIds);

  if (message.streamType === "damage") {
    damageByEncounter = new Map();
    for (const payload of decodeEncounterPayloads(DamageSchema, message.data)) {
      const totals = new Map<string, number>();
      for (const damage of payload.events) {
        const casterId = damage.caster ?? "";
        const name = message.players[casterId]?.name ?? (casterId || "Unknown");
        totals.set(name, (totals.get(name) ?? 0) + damage.amount);
      }
      damageByEncounter.set(payload.encounterId, totals);
    }
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

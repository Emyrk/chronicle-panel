import type { EncounterPayload } from "@emyrk/chronicle-panel-sdk/v1/events";
import type { Damage, Heal } from "@emyrk/chronicle-panel-sdk/v1/protobuf";

export interface FirstCastPlayer {
  name: string;
}

export interface FirstCastRow {
  playerId: string;
  name: string;
  kind: "damage" | "heal";
  spellId: number | null;
  spellName: string;
  target: string | null;
  atMs: number;
  /** Event index, used to order events that share a millisecond. */
  index: number;
}

export interface FirstCastEncounter {
  encounterId: string;
  /** Earliest payload timestamp across the damage and heal streams. */
  firstTimestampMs: number;
  rows: FirstCastRow[];
}

interface EncounterState {
  firstTimestampMs: number;
  firstByPlayer: Map<string, FirstCastRow>;
}

function considerEvents(
  encounters: Map<string, EncounterState>,
  payloads: EncounterPayload<Damage | Heal>[],
  kind: FirstCastRow["kind"],
  players: Record<string, FirstCastPlayer>,
): void {
  for (const payload of payloads) {
    let encounter = encounters.get(payload.encounterId);
    if (!encounter) {
      encounter = { firstTimestampMs: payload.firstTimestampMs, firstByPlayer: new Map() };
      encounters.set(payload.encounterId, encounter);
    }
    encounter.firstTimestampMs = Math.min(encounter.firstTimestampMs, payload.firstTimestampMs);

    for (const event of payload.events) {
      const casterId = event.caster;
      if (!casterId) continue;
      const player = players[casterId];
      if (!player) continue;
      const atMs = payload.firstTimestampMs + Number(event.meta?.offsetMilli ?? 0n);
      const index = event.meta?.index ?? 0;
      const existing = encounter.firstByPlayer.get(casterId);
      if (existing && (existing.atMs < atMs || (existing.atMs === atMs && existing.index <= index))) continue;
      encounter.firstByPlayer.set(casterId, {
        playerId: casterId,
        name: player.name,
        kind,
        spellId: event.spellData?.id ?? null,
        spellName: event.sourceName || event.spellData?.name || "Unknown ability",
        target: event.target || null,
        atMs,
        index,
      });
    }
  }
}

/**
 * Finds each player's first effective cast per encounter: the earliest damage
 * or heal event the player directly caused. Pet and guardian activity is not
 * attributed to the owner.
 */
export function buildFirstCasts(
  damagePayloads: EncounterPayload<Damage>[],
  healPayloads: EncounterPayload<Heal>[],
  players: Record<string, FirstCastPlayer>,
): FirstCastEncounter[] {
  const encounters = new Map<string, EncounterState>();
  considerEvents(encounters, damagePayloads, "damage", players);
  considerEvents(encounters, healPayloads, "heal", players);

  return [...encounters.entries()]
    .map(([encounterId, encounter]) => ({
      encounterId,
      firstTimestampMs: encounter.firstTimestampMs,
      rows: [...encounter.firstByPlayer.values()].sort((a, b) => a.atMs - b.atMs || a.index - b.index),
    }))
    .sort((a, b) => a.firstTimestampMs - b.firstTimestampMs);
}

/** Formats an encounter-relative offset as `m:ss.mmm`, keeping the sign. */
export function formatOffset(offsetMs: number): string {
  const safe = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  const abs = Math.abs(safe);
  const minutes = Math.floor(abs / 60_000);
  const seconds = ((abs % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return `${safe < 0 ? "-" : ""}${minutes}:${seconds}`;
}

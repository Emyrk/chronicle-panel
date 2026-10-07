import type { EncounterPayload } from "@emyrk/chronicle-panel-sdk/v1/events";
import type { Damage, UnitClassification } from "@emyrk/chronicle-panel-sdk/v1/protobuf";

export interface DamagePlayer {
  name: string;
}

export interface DamageUnit {
  name: string;
  owner?: string | null;
}

export interface ResolvedDamageEvent {
  encounterId: string;
  atMs: number;
  playerId: string;
  name: string;
  actorId: string;
  actorName: string;
  abilityName: string;
  amount: number;
}

export interface DamageBreakdownRow {
  actorName: string;
  abilityName: string;
  amount: number;
}

export interface DamageRow {
  playerId: string;
  name: string;
  amount: number;
  breakdown: DamageBreakdownRow[];
}

interface IndexedEvent {
  index: number;
  kind: "classification" | "damage";
  classification?: UnitClassification;
  damage?: Damage;
}

function rootOwner(
  guid: string,
  temporalOwners: ReadonlyMap<string, string>,
  units: Record<string, DamageUnit>,
): string | null {
  let current = guid;
  const seen = new Set([guid]);
  for (let depth = 0; depth < 5; depth += 1) {
    const owner = temporalOwners.get(current) ?? units[current]?.owner ?? null;
    if (!owner) return current === guid ? null : current;
    if (seen.has(owner)) return null;
    seen.add(owner);
    current = owner;
  }
  return current;
}

function damageAttribution(
  casterId: string,
  temporalOwners: Map<string, string>,
  players: Record<string, DamagePlayer>,
  units: Record<string, DamageUnit>,
): { playerId: string; name: string; actorId: string; actorName: string } | null {
  const directPlayer = players[casterId];
  if (directPlayer) {
    return { playerId: casterId, name: directPlayer.name, actorId: casterId, actorName: directPlayer.name };
  }

  const ownerId = rootOwner(casterId, temporalOwners, units);
  const owner = ownerId ? players[ownerId] : undefined;
  if (!owner || !ownerId) return null;

  return {
    playerId: ownerId,
    name: owner.name,
    actorId: casterId,
    actorName: units[casterId]?.name ?? casterId,
  };
}

export function resolveDamageEvents(
  damagePayloads: EncounterPayload<Damage>[],
  classificationPayloads: EncounterPayload<UnitClassification>[],
  players: Record<string, DamagePlayer>,
  units: Record<string, DamageUnit>,
): ResolvedDamageEvent[] {
  const classificationsByEncounter = new Map(
    classificationPayloads.map((payload) => [payload.encounterId, payload]),
  );
  const resolved: ResolvedDamageEvent[] = [];

  for (const damagePayload of damagePayloads) {
    const temporalOwners = new Map<string, string>();
    const indexed: IndexedEvent[] = [
      ...(classificationsByEncounter.get(damagePayload.encounterId)?.events ?? []).map((classification) => ({
        index: classification.meta?.index ?? 0,
        kind: "classification" as const,
        classification,
      })),
      ...damagePayload.events.map((damage) => ({
        index: damage.meta?.index ?? 0,
        kind: "damage" as const,
        damage,
      })),
    ].sort((a, b) => {
      const indexOrder = a.index - b.index;
      if (indexOrder !== 0) return indexOrder;
      const aKindOrder = a.kind === "classification" ? 0 : 1;
      const bKindOrder = b.kind === "classification" ? 0 : 1;
      return aKindOrder - bKindOrder;
    });

    for (const event of indexed) {
      if (event.classification) {
        const owner = event.classification.controller ?? event.classification.owner;
        if (owner) temporalOwners.set(event.classification.target, owner);
        else temporalOwners.delete(event.classification.target);
        continue;
      }

      const damage = event.damage!;
      const casterId = damage.caster || "Unknown";
      const attribution = damageAttribution(casterId, temporalOwners, players, units);
      if (!attribution) continue;
      resolved.push({
        encounterId: damagePayload.encounterId,
        atMs: damagePayload.firstTimestampMs + Number(damage.meta?.offsetMilli ?? 0n),
        ...attribution,
        abilityName: damage.sourceName || "Unknown ability",
        amount: damage.amount,
      });
    }
  }

  return resolved.sort((a, b) => a.atMs - b.atMs);
}

interface DamageTotal {
  playerId: string;
  name: string;
  amount: number;
  breakdown: Map<string, DamageBreakdownRow>;
}

function damageRows(totals: ReadonlyMap<string, DamageTotal>): DamageRow[] {
  return [...totals.values()]
    .map((total) => ({
      playerId: total.playerId,
      name: total.name,
      amount: total.amount,
      breakdown: [...total.breakdown.values()].sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export class DamageAccumulator {
  private cursor = 0;
  private totals = new Map<string, DamageTotal>();
  private selectionKey = "";
  private cutoffMs: number | null = null;
  private initialized = false;

  update(
    events: ResolvedDamageEvent[],
    selectedEncounterIds: ReadonlySet<string>,
    cutoffMs: number | null,
  ): DamageRow[] {
    const selectionKey = [...selectedEncounterIds].sort().join("\0");
    const movedBackward = this.initialized
      && this.cutoffMs !== null
      && cutoffMs !== null
      && cutoffMs < this.cutoffMs;
    const enteredReplay = this.initialized && this.cutoffMs === null && cutoffMs !== null;
    if (!this.initialized || selectionKey !== this.selectionKey || movedBackward || enteredReplay) {
      this.cursor = 0;
      this.totals = new Map();
    }

    while (this.cursor < events.length) {
      const event = events[this.cursor]!;
      if (cutoffMs !== null && event.atMs > cutoffMs) break;
      if (selectedEncounterIds.has(event.encounterId)) {
        let total = this.totals.get(event.playerId);
        if (!total) {
          total = {
            playerId: event.playerId,
            name: event.name,
            amount: 0,
            breakdown: new Map(),
          };
          this.totals.set(event.playerId, total);
        }
        total.amount += event.amount;
        const breakdownKey = `${event.actorId}\0${event.abilityName}`;
        const breakdown = total.breakdown.get(breakdownKey);
        if (breakdown) breakdown.amount += event.amount;
        else total.breakdown.set(breakdownKey, {
          actorName: event.actorName,
          abilityName: event.abilityName,
          amount: event.amount,
        });
      }
      this.cursor += 1;
    }

    this.selectionKey = selectionKey;
    this.cutoffMs = cutoffMs;
    this.initialized = true;
    return damageRows(this.totals);
  }
}

export function aggregateDamage(
  events: ResolvedDamageEvent[],
  selectedEncounterIds: ReadonlySet<string>,
  cutoffMs: number | null,
): DamageRow[] {
  return new DamageAccumulator().update(events, selectedEncounterIds, cutoffMs);
}

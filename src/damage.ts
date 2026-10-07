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
  name: string;
  amount: number;
}

export interface DamageRow {
  name: string;
  amount: number;
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

function entityName(
  casterId: string,
  temporalOwners: Map<string, string>,
  players: Record<string, DamagePlayer>,
  units: Record<string, DamageUnit>,
): string {
  const directPlayer = players[casterId]?.name;
  if (directPlayer) return directPlayer;

  const ownerId = rootOwner(casterId, temporalOwners, units);
  if (ownerId) {
    return players[ownerId]?.name ?? units[ownerId]?.name ?? ownerId;
  }

  return units[casterId]?.name ?? (casterId || "Unknown");
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
      resolved.push({
        encounterId: damagePayload.encounterId,
        atMs: damagePayload.firstTimestampMs + Number(damage.meta?.offsetMilli ?? 0n),
        name: entityName(casterId, temporalOwners, players, units),
        amount: damage.amount,
      });
    }
  }

  return resolved.sort((a, b) => a.atMs - b.atMs);
}

function damageRows(totals: ReadonlyMap<string, number>): DamageRow[] {
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export class DamageAccumulator {
  private cursor = 0;
  private totals = new Map<string, number>();
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
        this.totals.set(event.name, (this.totals.get(event.name) ?? 0) + event.amount);
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

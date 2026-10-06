import type { CombatantInfo } from "./generated/chronicle_pb";
import type { EncounterPayload } from "./sdk/stream";

export const GEAR_RARITIES = [
  { quality: 0, key: "poor", label: "Poor", shortLabel: "Gray" },
  { quality: 1, key: "common", label: "Common", shortLabel: "White" },
  { quality: 2, key: "uncommon", label: "Uncommon", shortLabel: "Green" },
  { quality: 3, key: "rare", label: "Rare", shortLabel: "Blue" },
  { quality: 4, key: "epic", label: "Epic", shortLabel: "Purple" },
  { quality: 5, key: "legendary", label: "Legendary", shortLabel: "Orange" },
  { quality: 6, key: "artifact", label: "Artifact", shortLabel: "Artifact" },
] as const;

export type GearRaritySortKey = "name" | typeof GEAR_RARITIES[number]["key"] | "unknown";
export type GearRaritySortDirection = "asc" | "desc";

export interface GearPlayerSnapshot {
  guid: string;
  name: string;
  heroClass: string;
  itemIds: number[];
}

export interface GearRarityRow extends GearPlayerSnapshot {
  counts: Record<typeof GEAR_RARITIES[number]["key"] | "unknown", number>;
}

export interface ItemQualityMetadata {
  entry: number;
  quality: number;
}

export function latestGearByPlayer(payloads: EncounterPayload<CombatantInfo>[]): GearPlayerSnapshot[] {
  const latest = new Map<string, { atMs: number; index: number; player: GearPlayerSnapshot }>();
  for (const payload of payloads) {
    for (const event of payload.events) {
      const atMs = payload.firstTimestampMs + Number(event.meta?.offsetMilli ?? 0n);
      const index = event.meta?.index ?? 0;
      const previous = latest.get(event.guid);
      if (previous && (previous.atMs > atMs || (previous.atMs === atMs && previous.index > index))) continue;
      latest.set(event.guid, {
        atMs,
        index,
        player: {
          guid: event.guid,
          name: event.name || event.guid,
          heroClass: event.heroClass,
          itemIds: event.gear.map((slot) => slot.itemId).filter((itemId) => itemId > 0),
        },
      });
    }
  }
  return [...latest.values()].map((entry) => entry.player);
}

export function latestGearForSelectedEncounters(
  payloads: EncounterPayload<CombatantInfo>[],
  selectedEncounterIds: ReadonlySet<string>,
): GearPlayerSnapshot[] {
  return latestGearByPlayer(payloads.filter((payload) => selectedEncounterIds.has(payload.encounterId)));
}

export function uniqueGearItemIds(players: GearPlayerSnapshot[]): number[] {
  return [...new Set(players.flatMap((player) => player.itemIds))].sort((a, b) => a - b);
}

export function buildGearRarityRows(
  players: GearPlayerSnapshot[],
  metadata: ItemQualityMetadata[],
): GearRarityRow[] {
  const qualities = new Map(metadata.map((item) => [item.entry, item.quality]));
  return players.map((player) => {
    const counts: GearRarityRow["counts"] = {
      poor: 0,
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      artifact: 0,
      unknown: 0,
    };
    for (const itemId of player.itemIds) {
      const rarity = GEAR_RARITIES.find((entry) => entry.quality === qualities.get(itemId));
      if (rarity) counts[rarity.key] += 1;
      else counts.unknown += 1;
    }
    return { ...player, counts };
  });
}

export function sortGearRarityRows(
  rows: GearRarityRow[],
  key: GearRaritySortKey,
  direction: GearRaritySortDirection,
): GearRarityRow[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName * multiplier;
    } else {
      const difference = a.counts[key] - b.counts[key];
      if (difference !== 0) return difference * multiplier;
    }
    return a.name.localeCompare(b.name) || a.guid.localeCompare(b.guid);
  });
}

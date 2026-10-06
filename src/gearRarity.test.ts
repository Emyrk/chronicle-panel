import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { CombatantInfoSchema } from "./generated/chronicle_pb";
import { buildGearRarityRows, latestGearByPlayer, latestGearForSelectedEncounters, sortGearRarityRows, uniqueGearItemIds } from "./gearRarity";

function combatant(guid: string, name: string, index: number, itemIds: number[]) {
  return create(CombatantInfoSchema, {
    meta: { index, offsetMilli: BigInt(index) },
    guid,
    name,
    heroClass: "Warrior",
    gear: itemIds.map((itemId) => ({ itemId, gemEnchantIds: [] })),
  });
}

describe("gear rarity aggregation", () => {
  it("uses each player's latest gear snapshot and unique positive item IDs", () => {
    const players = latestGearByPlayer([
      {
        encounterId: "encounter-1",
        firstTimestampMs: 1_000,
        events: [
          combatant("Player-1", "Alice", 1, [10, 0, 20]),
          combatant("Player-1", "Alice", 2, [20, 30]),
          combatant("Player-2", "Bob", 3, [10, 40]),
        ],
      },
    ]);

    expect(players).toEqual([
      { guid: "Player-1", name: "Alice", heroClass: "Warrior", itemIds: [20, 30] },
      { guid: "Player-2", name: "Bob", heroClass: "Warrior", itemIds: [10, 40] },
    ]);
    expect(uniqueGearItemIds(players)).toEqual([10, 20, 30, 40]);
  });

  it("uses only selected encounters when resolving latest gear", () => {
    const payloads = [
      { encounterId: "encounter-1", firstTimestampMs: 1_000, events: [combatant("Player-1", "Alice", 1, [10])] },
      { encounterId: "encounter-2", firstTimestampMs: 2_000, events: [combatant("Player-1", "Alice", 2, [20])] },
    ];

    expect(latestGearForSelectedEncounters(payloads, new Set(["encounter-1"]))[0]?.itemIds).toEqual([10]);
    expect(latestGearForSelectedEncounters(payloads, new Set(["encounter-2"]))[0]?.itemIds).toEqual([20]);
  });

  it("counts all supported rarities and unknown items", () => {
    const rows = buildGearRarityRows(
      [{ guid: "Player-1", name: "Alice", heroClass: "Mage", itemIds: [10, 11, 12, 13, 14, 15, 16, 99] }],
      [0, 1, 2, 3, 4, 5, 6].map((quality, index) => ({ entry: 10 + index, quality })),
    );

    expect(rows[0]?.counts).toEqual({
      poor: 1,
      common: 1,
      uncommon: 1,
      rare: 1,
      epic: 1,
      legendary: 1,
      artifact: 1,
      unknown: 1,
    });
  });

  it("sorts by rarity count with deterministic name ties", () => {
    const rows = buildGearRarityRows(
      [
        { guid: "Player-2", name: "Bob", heroClass: "Mage", itemIds: [10] },
        { guid: "Player-1", name: "Alice", heroClass: "Mage", itemIds: [11] },
        { guid: "Player-3", name: "Cara", heroClass: "Mage", itemIds: [12, 13] },
      ],
      [10, 11, 12, 13].map((entry) => ({ entry, quality: 4 })),
    );

    expect(sortGearRarityRows(rows, "epic", "desc").map((row) => row.name)).toEqual(["Cara", "Alice", "Bob"]);
    expect(sortGearRarityRows(rows, "name", "desc").map((row) => row.name)).toEqual(["Cara", "Bob", "Alice"]);
  });
});

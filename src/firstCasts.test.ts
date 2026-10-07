import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import type { EncounterPayload } from "@emyrk/chronicle-panel-sdk/v1/events";
import { DamageSchema, HealSchema, type Damage, type Heal } from "@emyrk/chronicle-panel-sdk/v1/protobuf";
import { buildFirstCasts, formatOffset } from "./firstCasts";

const players = {
  "Player-1": { name: "Hunter" },
  "Player-2": { name: "Priest" },
  "Player-3": { name: "Warrior" },
};

function damage(index: number, offsetMilli: number, caster: string, sourceName: string, target = "Creature-1") {
  return create(DamageSchema, { meta: { index, offsetMilli: BigInt(offsetMilli) }, caster, target, sourceName, amount: 10 });
}

function heal(index: number, offsetMilli: number, caster: string, sourceName: string, target = "Player-3") {
  return create(HealSchema, { meta: { index, offsetMilli: BigInt(offsetMilli) }, caster, target, sourceName, amount: 10 });
}

function payload<T>(encounterId: string, firstTimestampMs: number, events: T[]): EncounterPayload<T> {
  return { encounterId, firstTimestampMs, events } as EncounterPayload<T>;
}

describe("buildFirstCasts", () => {
  it("keeps each player's earliest damage or heal event, ordered by time", () => {
    const result = buildFirstCasts(
      [payload<Damage>("enc-1", 1_000, [
        damage(1, 500, "Player-1", "Aimed Shot"),
        damage(4, 2_000, "Player-3", "Heroic Strike"),
        damage(5, 3_000, "Player-1", "Multi-Shot"),
        damage(6, 100, "Creature-1", "Cleave", "Player-3"),
        damage(7, 50, "Pet-1", "Claw"),
      ])],
      [payload<Heal>("enc-1", 1_000, [
        heal(2, 900, "Player-2", "Renew"),
        heal(3, 400, "Player-1", "Bandage"),
      ])],
      players,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.rows.map((row) => [row.name, row.spellName, row.kind, row.atMs])).toEqual([
      ["Hunter", "Bandage", "heal", 1_400],
      ["Priest", "Renew", "heal", 1_900],
      ["Warrior", "Heroic Strike", "damage", 3_000],
    ]);
  });

  it("ignores synthetic events", () => {
    const synthetic = heal(1, 0, "Player-2", "Renew");
    synthetic.meta!.isSynthetic = true;
    const result = buildFirstCasts(
      [payload<Damage>("enc-1", 1_000, [damage(2, 800, "Player-2", "Smite")])],
      [payload<Heal>("enc-1", 1_000, [synthetic])],
      players,
    );
    expect(result[0]!.rows.map((row) => row.spellName)).toEqual(["Smite"]);
  });

  it("compares streams by absolute time and breaks ties by event index", () => {
    const result = buildFirstCasts(
      [payload<Damage>("enc-1", 2_000, [damage(9, 0, "Player-1", "Arcane Shot")])],
      [payload<Heal>("enc-1", 1_500, [heal(8, 500, "Player-1", "Bandage")])],
      players,
    );
    expect(result[0]!.firstTimestampMs).toBe(1_500);
    expect(result[0]!.rows[0]!.spellName).toBe("Bandage");
  });

  it("tracks encounters independently", () => {
    const result = buildFirstCasts(
      [
        payload<Damage>("enc-2", 50_000, [damage(1, 10, "Player-1", "Serpent Sting")]),
        payload<Damage>("enc-1", 1_000, [damage(1, 20, "Player-1", "Aimed Shot")]),
      ],
      [],
      players,
    );
    expect(result.map((encounter) => [encounter.encounterId, encounter.rows[0]!.spellName])).toEqual([
      ["enc-1", "Aimed Shot"],
      ["enc-2", "Serpent Sting"],
    ]);
  });
});

describe("formatOffset", () => {
  it("formats millisecond offsets", () => {
    expect(formatOffset(0)).toBe("0:00.000");
    expect(formatOffset(65_432)).toBe("1:05.432");
    expect(formatOffset(-1_250)).toBe("-0:01.250");
    expect(formatOffset(Number.NaN)).toBe("0:00.000");
  });
});

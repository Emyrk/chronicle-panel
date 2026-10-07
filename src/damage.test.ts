import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { DamageSchema, UnitClassificationSchema } from "@emyrk/chronicle-panel-sdk/v1/protobuf";
import { aggregateDamage, DamageAccumulator, resolveDamageEvents } from "./damage";

const players = {
  "Player-1": { name: "Hunter" },
  "Player-2": { name: "Priest" },
};

function damage(index: number, offsetMilli: number, caster: string, amount: number) {
  return create(DamageSchema, {
    meta: { index, offsetMilli: BigInt(offsetMilli) },
    caster,
    target: "Creature-1",
    sourceName: "Attack",
    amount,
  });
}

function classification(index: number, target: string, owner?: string, controller?: string) {
  return create(UnitClassificationSchema, {
    meta: { index, offsetMilli: 0n },
    target,
    owner,
    controller,
  });
}

describe("resolveDamageEvents", () => {
  it("attributes pets to their static owner", () => {
    const events = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Pet-1", 50)] }],
      [],
      players,
      { "Pet-1": { name: "Wolf", owner: "Player-1" } },
    );

    expect(events).toEqual([{ encounterId: "encounter-1", atMs: 1_100, name: "Hunter", amount: 50 }]);
  });

  it("follows temporal owner and controller changes in event order", () => {
    const events = resolveDamageEvents(
      [{
        encounterId: "encounter-1",
        firstTimestampMs: 1_000,
        events: [damage(2, 100, "Pet-1", 50), damage(4, 200, "Pet-1", 75)],
      }],
      [{
        encounterId: "encounter-1",
        firstTimestampMs: 1_000,
        events: [
          classification(1, "Pet-1", undefined, "Player-2"),
          classification(3, "Pet-1", "Player-1"),
        ],
      }],
      players,
      { "Pet-1": { name: "Wolf" } },
    );

    expect(events.map(({ name, amount }) => ({ name, amount }))).toEqual([
      { name: "Priest", amount: 50 },
      { name: "Hunter", amount: 75 },
    ]);
  });

  it("resolves chained owners and rejects ownership cycles", () => {
    const chained = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Pet-2", 50)] }],
      [],
      players,
      {
        "Pet-2": { name: "Imp", owner: "Pet-1" },
        "Pet-1": { name: "Wolf", owner: "Player-1" },
      },
    );
    expect(chained[0]?.name).toBe("Hunter");

    const cyclic = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Pet-1", 50)] }],
      [],
      players,
      {
        "Pet-1": { name: "Wolf", owner: "Pet-2" },
        "Pet-2": { name: "Imp", owner: "Pet-1" },
      },
    );
    expect(cyclic[0]?.name).toBe("Wolf");
  });
});

describe("aggregateDamage", () => {
  const events = [
    { encounterId: "encounter-1", atMs: 1_100, name: "Hunter", amount: 50 },
    { encounterId: "encounter-2", atMs: 1_150, name: "Priest", amount: 100 },
    { encounterId: "encounter-1", atMs: 1_200, name: "Hunter", amount: 75 },
  ];

  it("tracks the replay cutoff and selected encounters", () => {
    expect(aggregateDamage(events, new Set(["encounter-1"]), 1_150)).toEqual([
      { name: "Hunter", amount: 50 },
    ]);
    expect(aggregateDamage(events, new Set(["encounter-1"]), 1_250)).toEqual([
      { name: "Hunter", amount: 125 },
    ]);
  });

  it("advances efficiently and resets when replay seeks backward", () => {
    const accumulator = new DamageAccumulator();
    const selected = new Set(["encounter-1"]);

    expect(accumulator.update(events, selected, 1_150)).toEqual([
      { name: "Hunter", amount: 50 },
    ]);
    expect(accumulator.update(events, selected, 1_250)).toEqual([
      { name: "Hunter", amount: 125 },
    ]);
    expect(accumulator.update(events, selected, 1_150)).toEqual([
      { name: "Hunter", amount: 50 },
    ]);
  });

  it("resets when leaving and re-entering replay", () => {
    const accumulator = new DamageAccumulator();
    const selected = new Set(["encounter-1"]);

    expect(accumulator.update(events, selected, 1_150)).toEqual([
      { name: "Hunter", amount: 50 },
    ]);
    expect(accumulator.update(events, selected, null)).toEqual([
      { name: "Hunter", amount: 125 },
    ]);
    expect(accumulator.update(events, selected, 1_150)).toEqual([
      { name: "Hunter", amount: 50 },
    ]);
  });

  it("uses full selected-encounter totals outside replay", () => {
    expect(aggregateDamage(events, new Set(["encounter-1", "encounter-2"]), null)).toEqual([
      { name: "Hunter", amount: 125 },
      { name: "Priest", amount: 100 },
    ]);
  });
});

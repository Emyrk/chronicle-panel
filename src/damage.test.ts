import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { DamageSchema, UnitClassificationSchema } from "@emyrk/chronicle-panel-sdk/v1/protobuf";
import { aggregateDamage, DamageAccumulator, resolveDamageEvents, type DamageRow, type ResolvedDamageEvent } from "./damage";

const players = {
  "Player-1": { name: "Hunter" },
  "Player-2": { name: "Priest" },
};

function damage(index: number, offsetMilli: number, caster: string, amount: number, sourceName = "Attack") {
  return create(DamageSchema, {
    meta: { index, offsetMilli: BigInt(offsetMilli) },
    caster,
    target: "Creature-1",
    sourceName,
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

function resolvedDamage(
  encounterId: string,
  atMs: number,
  playerId: string,
  name: string,
  amount: number,
  actorName = name,
  abilityName = "Attack",
): ResolvedDamageEvent {
  return {
    encounterId,
    atMs,
    playerId,
    name,
    actorId: actorName === name ? playerId : `Actor-${actorName}`,
    actorName,
    abilityName,
    amount,
  };
}

function damageRow(
  playerId: string,
  name: string,
  amount: number,
  breakdown: DamageRow["breakdown"] = [{ actorName: name, abilityName: "Attack", amount }],
): DamageRow {
  return { playerId, name, amount, breakdown };
}

describe("resolveDamageEvents", () => {
  it("attributes pets to their static owner", () => {
    const events = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Pet-1", 50)] }],
      [],
      players,
      { "Pet-1": { name: "Wolf", owner: "Player-1" } },
    );

    expect(events).toEqual([{
      encounterId: "encounter-1",
      atMs: 1_100,
      playerId: "Player-1",
      name: "Hunter",
      actorId: "Pet-1",
      actorName: "Wolf",
      abilityName: "Attack",
      amount: 50,
    }]);
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

    expect(events.map(({ name, actorName, amount }) => ({ name, actorName, amount }))).toEqual([
      { name: "Priest", actorName: "Wolf", amount: 50 },
      { name: "Hunter", actorName: "Wolf", amount: 75 },
    ]);
  });

  it("excludes damage that cannot be attributed to a player", () => {
    const events = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Creature-2", 500)] }],
      [],
      players,
      { "Creature-2": { name: "Enemy" } },
    );

    expect(events).toEqual([]);
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
    expect(chained[0]).toMatchObject({ name: "Hunter", actorName: "Imp" });

    const cyclic = resolveDamageEvents(
      [{ encounterId: "encounter-1", firstTimestampMs: 1_000, events: [damage(1, 100, "Pet-1", 50)] }],
      [],
      players,
      {
        "Pet-1": { name: "Wolf", owner: "Pet-2" },
        "Pet-2": { name: "Imp", owner: "Pet-1" },
      },
    );
    expect(cyclic).toEqual([]);
  });
});

describe("aggregateDamage", () => {
  const events = [
    resolvedDamage("encounter-1", 1_100, "Player-1", "Hunter", 50),
    resolvedDamage("encounter-2", 1_150, "Player-2", "Priest", 100, "Priest", "Smite"),
    resolvedDamage("encounter-1", 1_200, "Player-1", "Hunter", 75, "Wolf", "Bite"),
  ];
  const hunterFull = damageRow("Player-1", "Hunter", 125, [
    { actorName: "Wolf", abilityName: "Bite", amount: 75 },
    { actorName: "Hunter", abilityName: "Attack", amount: 50 },
  ]);

  it("tracks the replay cutoff and selected encounters", () => {
    expect(aggregateDamage(events, new Set(["encounter-1"]), 1_150)).toEqual([
      damageRow("Player-1", "Hunter", 50),
    ]);
    expect(aggregateDamage(events, new Set(["encounter-1"]), 1_250)).toEqual([hunterFull]);
  });

  it("advances efficiently and resets when replay seeks backward", () => {
    const accumulator = new DamageAccumulator();
    const selected = new Set(["encounter-1"]);

    expect(accumulator.update(events, selected, 1_150)).toEqual([
      damageRow("Player-1", "Hunter", 50),
    ]);
    expect(accumulator.update(events, selected, 1_250)).toEqual([hunterFull]);
    expect(accumulator.update(events, selected, 1_150)).toEqual([
      damageRow("Player-1", "Hunter", 50),
    ]);
  });

  it("resets when leaving and re-entering replay", () => {
    const accumulator = new DamageAccumulator();
    const selected = new Set(["encounter-1"]);

    expect(accumulator.update(events, selected, 1_150)).toEqual([
      damageRow("Player-1", "Hunter", 50),
    ]);
    expect(accumulator.update(events, selected, null)).toEqual([hunterFull]);
    expect(accumulator.update(events, selected, 1_150)).toEqual([
      damageRow("Player-1", "Hunter", 50),
    ]);
  });

  it("uses full selected-encounter totals outside replay", () => {
    expect(aggregateDamage(events, new Set(["encounter-1", "encounter-2"]), null)).toEqual([
      hunterFull,
      damageRow("Player-2", "Priest", 100, [
        { actorName: "Priest", abilityName: "Smite", amount: 100 },
      ]),
    ]);
  });
});

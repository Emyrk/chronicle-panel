import { describe, expect, it } from "vitest";
import { formatElapsedTime } from "./time";

describe("formatElapsedTime", () => {
  it("formats event offsets as encounter-relative minutes and seconds", () => {
    expect(formatElapsedTime(0)).toBe("0:00");
    expect(formatElapsedTime(65_432)).toBe("1:05");
  });

  it("never renders NaN for invalid or negative offsets", () => {
    expect(formatElapsedTime(Number.NaN)).toBe("0:00");
    expect(formatElapsedTime(-1_000)).toBe("0:00");
  });
});

import { describe, expect, it } from "vitest";
import type { Preset } from "../types";
import { summarizePreset } from "./presets";

describe("summarizePreset", () => {
  it("counts enabled rules and trigger modes", () => {
    const preset: Preset = {
      id: "p",
      name: "Preset",
      description: "",
      schemaVersion: 1,
      playback: {
        speed: 1,
        transpose: 0,
        octaveFold: { enabled: false, minNote: 48, maxNote: 83 },
        globalDelayMs: 0,
      },
      rules: [
        {
          id: "a",
          enabled: true,
          name: "A",
          inputSource: "all",
          eventType: "noteOn",
          track: null,
          channel: null,
          note: { kind: "single", value: 60 },
          velocity: { min: 1, max: 127 },
          output: { keys: ["A"] },
          triggerMode: "tap",
          pressDurationMs: 35,
          retriggerGapMs: 12,
          delayMs: 0,
        },
        {
          id: "b",
          enabled: false,
          name: "B",
          inputSource: "all",
          eventType: "noteOn",
          track: null,
          channel: null,
          note: { kind: "single", value: 61 },
          velocity: { min: 1, max: 127 },
          output: { keys: ["S"] },
          triggerMode: "hold",
          pressDurationMs: 35,
          retriggerGapMs: 12,
          delayMs: 0,
        },
      ],
    };

    const summary = summarizePreset(preset);

    expect(summary.enabledRules).toBe(1);
    expect(summary.triggerModes).toEqual(["tap", "hold"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Preset } from "../types";
import {
  addRuleToPreset,
  formatRuleKeys,
  noteInputValue,
  parseSingleNoteInput,
  removeRuleFromPreset,
  updateRuleInPreset,
} from "./ruleEditing";

function testPreset(): Preset {
  return {
    schemaVersion: 1,
    id: "test",
    name: "Test",
    description: "",
    playback: {
      speed: 1,
      transpose: 0,
      octaveFold: { enabled: false, minNote: 48, maxNote: 83 },
      globalDelayMs: 0,
    },
    rules: [
      {
        id: "rule-1",
        enabled: true,
        name: "C4 -> A",
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
    ],
  };
}

describe("rule editing helpers", () => {
  it("adds a ready-to-edit rule with a unique id", () => {
    const preset = addRuleToPreset(testPreset());

    expect(preset.rules).toHaveLength(2);
    expect(preset.rules[1]).toMatchObject({
      id: "custom-rule-1",
      enabled: true,
      name: "C4 -> A",
      inputSource: "all",
      eventType: "noteOn",
      triggerMode: "tap",
      pressDurationMs: 35,
    });
  });

  it("updates only the matching rule", () => {
    const preset = addRuleToPreset(testPreset());
    const updated = updateRuleInPreset(preset, "custom-rule-1", {
      output: { keys: ["Q", "W"] },
      triggerMode: "hold",
      pressDurationMs: 120,
    });

    expect(updated.rules[0].output.keys).toEqual(["A"]);
    expect(updated.rules[1].output.keys).toEqual(["Q", "W"]);
    expect(updated.rules[1].triggerMode).toBe("hold");
    expect(updated.rules[1].pressDurationMs).toBe(120);
  });

  it("removes a rule by id", () => {
    const preset = addRuleToPreset(testPreset());
    const updated = removeRuleFromPreset(preset, "rule-1");

    expect(updated.rules.map((rule) => rule.id)).toEqual(["custom-rule-1"]);
  });

  it("parses readable note names and midi numbers", () => {
    expect(parseSingleNoteInput("C4")).toBe(60);
    expect(parseSingleNoteInput("c#4")).toBe(61);
    expect(parseSingleNoteInput("60")).toBe(60);
    expect(parseSingleNoteInput("H4")).toBeNull();
    expect(parseSingleNoteInput("128")).toBeNull();
  });

  it("formats editable rule fields", () => {
    const rule = testPreset().rules[0];

    expect(noteInputValue(rule.note)).toBe("C4");
    expect(formatRuleKeys(rule)).toBe("A");
  });
});

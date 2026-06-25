import { describe, expect, it } from "vitest";
import type { Preset } from "../types";
import { fallbackGenshinPreset } from "./presets";
import { parseStoredKeymap, stringifyKeymap } from "./keymapStorage";

function preset(id: string): Preset {
  return { ...fallbackGenshinPreset(), id, name: id };
}

describe("keymap storage", () => {
  it("round-trips presets and selected preset id", () => {
    const keymap = {
      presets: [preset("genshin-21-key"), preset("custom")],
      selectedPresetId: "custom",
    };

    expect(parseStoredKeymap(stringifyKeymap(keymap))).toEqual(keymap);
  });

  it("ignores malformed or empty saved keymaps", () => {
    expect(parseStoredKeymap(null)).toBeNull();
    expect(parseStoredKeymap("{")).toBeNull();
    expect(parseStoredKeymap(JSON.stringify({ presets: [] }))).toBeNull();
    expect(
      parseStoredKeymap(JSON.stringify({ presets: [], selectedPresetId: "" })),
    ).toBeNull();
  });
});

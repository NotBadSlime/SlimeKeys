import { describe, expect, it } from "vitest";
import type { Preset } from "../types";
import {
  createPresetFromSource,
  deletePresetById,
  fileNameForPreset,
  prepareImportedPreset,
  withJsonExtension,
} from "./presetManagement";

function preset(id: string, name: string): Preset {
  return {
    schemaVersion: 1,
    id,
    name,
    description: "",
    playback: {
      speed: 1,
      transpose: 0,
      octaveFold: { enabled: false, minNote: 48, maxNote: 83 },
      globalDelayMs: 0,
    },
    rules: [],
  };
}

describe("preset management", () => {
  it("creates a copy of the selected preset with a unique id and name", () => {
    const current = preset("genshin-21-key", "Genshin 21-Key");
    const created = createPresetFromSource(current, [
      current,
      preset("genshin-21-key-copy-1", "Genshin 21-Key Copy 1"),
    ]);

    expect(created.id).toBe("genshin-21-key-copy-2");
    expect(created.name).toBe("Genshin 21-Key Copy 2");
    expect(created.rules).not.toBe(current.rules);
  });

  it("renames imported presets when ids collide", () => {
    const imported = preset("genshin-21-key", "Genshin 21-Key");
    const prepared = prepareImportedPreset(imported, [imported]);

    expect(prepared.id).toBe("genshin-21-key-import-1");
    expect(prepared.name).toBe("Genshin 21-Key Import 1");
  });

  it("deletes selected preset and selects a nearby preset", () => {
    const presets = [
      preset("a", "A"),
      preset("b", "B"),
      preset("c", "C"),
    ];

    const result = deletePresetById(presets, "b");

    expect(result.deleted).toBe(true);
    expect(result.presets.map((item) => item.id)).toEqual(["a", "c"]);
    expect(result.selectedPresetId).toBe("c");
  });

  it("keeps the last preset", () => {
    const presets = [preset("a", "A")];

    const result = deletePresetById(presets, "a");

    expect(result.deleted).toBe(false);
    expect(result.presets).toEqual(presets);
    expect(result.selectedPresetId).toBe("a");
  });

  it("builds a safe json file name", () => {
    expect(fileNameForPreset(preset("p", "Genshin 21-Key!"))).toBe(
      "Genshin-21-Key.json",
    );
  });

  it("adds a json extension when missing", () => {
    expect(withJsonExtension("C:/tmp/preset")).toBe("C:/tmp/preset.json");
    expect(withJsonExtension("C:/tmp/preset.JSON")).toBe("C:/tmp/preset.JSON");
  });
});

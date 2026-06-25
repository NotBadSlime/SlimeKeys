import type { Preset } from "../types";

export interface StoredKeymap {
  presets: Preset[];
  selectedPresetId: string;
}

export function stringifyKeymap(keymap: StoredKeymap): string {
  return JSON.stringify(keymap);
}

export function parseStoredKeymap(value: string | null): StoredKeymap | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StoredKeymap>;
    if (
      !Array.isArray(parsed.presets) ||
      parsed.presets.length === 0 ||
      typeof parsed.selectedPresetId !== "string" ||
      parsed.selectedPresetId.trim().length === 0
    ) {
      return null;
    }

    return {
      presets: parsed.presets,
      selectedPresetId: parsed.selectedPresetId,
    };
  } catch {
    return null;
  }
}

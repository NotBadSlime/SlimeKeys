import type { Preset } from "../types";

export interface DeletePresetResult {
  deleted: boolean;
  presets: Preset[];
  selectedPresetId: string;
}

export function createPresetFromSource(
  source: Preset,
  existingPresets: Preset[],
): Preset {
  const index = nextNameIndex(`${source.name} Copy`, existingPresets);
  const name = `${source.name} Copy ${index}`;
  return {
    ...structuredClone(source),
    id: uniquePresetId(`${source.id}-copy-${index}`, existingPresets),
    name,
  };
}

export function prepareImportedPreset(
  preset: Preset,
  existingPresets: Preset[],
): Preset {
  const idExists = existingPresets.some((item) => item.id === preset.id);
  const nameExists = existingPresets.some((item) => item.name === preset.name);
  if (!idExists && !nameExists) {
    return structuredClone(preset);
  }

  const index = nextNameIndex(`${preset.name} Import`, existingPresets);
  return {
    ...structuredClone(preset),
    id: uniquePresetId(`${preset.id}-import-${index}`, existingPresets),
    name: `${preset.name} Import ${index}`,
  };
}

export function deletePresetById(
  presets: Preset[],
  selectedPresetId: string,
): DeletePresetResult {
  if (presets.length <= 1) {
    return {
      deleted: false,
      presets,
      selectedPresetId: presets[0]?.id ?? selectedPresetId,
    };
  }

  const selectedIndex = Math.max(
    0,
    presets.findIndex((preset) => preset.id === selectedPresetId),
  );
  const nextPresets = presets.filter((preset) => preset.id !== selectedPresetId);
  const nextIndex = Math.min(selectedIndex, nextPresets.length - 1);

  return {
    deleted: nextPresets.length !== presets.length,
    presets: nextPresets,
    selectedPresetId: nextPresets[nextIndex]?.id ?? "",
  };
}

export function fileNameForPreset(preset: Preset): string {
  const safeName = preset.name
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeName || "SlimeKeys-Preset"}.json`;
}

export function withJsonExtension(path: string): string {
  return /\.json$/i.test(path) ? path : `${path}.json`;
}

function nextNameIndex(baseName: string, existingPresets: Preset[]): number {
  const names = new Set(existingPresets.map((preset) => preset.name));
  let index = 1;
  while (names.has(`${baseName} ${index}`)) {
    index += 1;
  }
  return index;
}

function uniquePresetId(baseId: string, existingPresets: Preset[]): string {
  const ids = new Set(existingPresets.map((preset) => preset.id));
  const slug = slugify(baseId);
  if (!ids.has(slug)) {
    return slug;
  }

  let index = 1;
  while (ids.has(`${slug}-${index}`)) {
    index += 1;
  }
  return `${slug}-${index}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "preset";
}

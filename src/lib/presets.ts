import type { MidiEventType, NoteFilter, Preset, TriggerMode } from "../types";

export interface PresetSummary {
  enabledRules: number;
  triggerModes: TriggerMode[];
}

export function summarizePreset(preset: Preset): PresetSummary {
  return {
    enabledRules: preset.rules.filter((rule) => rule.enabled).length,
    triggerModes: Array.from(
      new Set(preset.rules.map((rule) => rule.triggerMode)),
    ),
  };
}

export function formatNoteFilter(note: NoteFilter): string {
  switch (note.kind) {
    case "single":
      return midiNoteName(note.value);
    case "range":
      return `${midiNoteName(note.min)}-${midiNoteName(note.max)}`;
    case "list":
      return note.values.map(midiNoteName).join(", ");
  }
}

export function midiNoteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}

export function eventTypeLabel(eventType: MidiEventType): string {
  return {
    noteOn: "Note On",
    noteOff: "Note Off",
    both: "On + Off",
  }[eventType];
}

export function triggerModeLabel(triggerMode: TriggerMode): string {
  return {
    tap: "Tap",
    hold: "Hold",
    retrigger: "Retrigger",
    chop: "Chop",
  }[triggerMode];
}

export function fallbackGenshinPreset(): Preset {
  const mappings: Array<[string, number, string]> = [
    ["C3", 48, "Z"],
    ["D3", 50, "X"],
    ["E3", 52, "C"],
    ["F3", 53, "V"],
    ["G3", 55, "B"],
    ["A3", 57, "N"],
    ["B3", 59, "M"],
    ["C4", 60, "A"],
    ["D4", 62, "S"],
    ["E4", 64, "D"],
    ["F4", 65, "F"],
    ["G4", 67, "G"],
    ["A4", 69, "H"],
    ["B4", 71, "J"],
    ["C5", 72, "Q"],
    ["D5", 74, "W"],
    ["E5", 76, "E"],
    ["F5", 77, "R"],
    ["G5", 79, "T"],
    ["A5", 81, "Y"],
    ["B5", 83, "U"],
  ];

  return {
    schemaVersion: 1,
    id: "genshin-21-key",
    name: "Genshin 21-Key",
    description: "Default 21-key game instrument mapping.",
    playback: {
      speed: 1,
      transpose: 0,
      octaveFold: { enabled: false, minNote: 48, maxNote: 83 },
      globalDelayMs: 0,
    },
    rules: mappings.map(([noteName, note, key]) => ({
      id: `${noteName.toLowerCase()}-to-${key.toLowerCase()}`,
      enabled: true,
      name: `${noteName} -> ${key}`,
      inputSource: "all",
      eventType: "both",
      track: null,
      channel: null,
      note: { kind: "single", value: note },
      velocity: { min: 1, max: 127 },
      output: { keys: [key] },
      triggerMode: "retrigger",
      pressDurationMs: 35,
      retriggerGapMs: 12,
      delayMs: 0,
    })),
  };
}

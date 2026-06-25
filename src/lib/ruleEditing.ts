import type { NoteFilter, Preset, Rule } from "../types";
import { formatNoteFilter } from "./presets";

export function addRuleToPreset(preset: Preset): Preset {
  const rule = defaultEditableRule(nextRuleId(preset.rules));
  return { ...preset, rules: [...preset.rules, rule] };
}

export function updateRuleInPreset(
  preset: Preset,
  ruleId: string,
  patch: Partial<Rule>,
): Preset {
  return {
    ...preset,
    rules: preset.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...patch } : rule,
    ),
  };
}

export function removeRuleFromPreset(preset: Preset, ruleId: string): Preset {
  return {
    ...preset,
    rules: preset.rules.filter((rule) => rule.id !== ruleId),
  };
}

export function parseSingleNoteInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const midiNumber = Number(trimmed);
  if (Number.isInteger(midiNumber) && midiNumber >= 0 && midiNumber <= 127) {
    return midiNumber;
  }

  const match = /^([a-g])([#b]?)(-?\d+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const baseNotes: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  const name = match[1].toUpperCase();
  const accidental = match[2];
  const octave = Number(match[3]);
  const offset = accidental === "#" ? 1 : accidental.toLowerCase() === "b" ? -1 : 0;
  const note = (octave + 1) * 12 + baseNotes[name] + offset;

  return note >= 0 && note <= 127 ? note : null;
}

export function noteInputValue(note: NoteFilter): string {
  return formatNoteFilter(note);
}

export function keysFromInput(input: string): string[] {
  return input
    .split(/[,+\s]+/)
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => key.toUpperCase());
}

export function formatRuleKeys(rule: Rule): string {
  return rule.output.keys.join(" + ");
}

function nextRuleId(rules: Rule[]): string {
  const ids = new Set(rules.map((rule) => rule.id));
  let index = 1;
  while (ids.has(`custom-rule-${index}`)) {
    index += 1;
  }
  return `custom-rule-${index}`;
}

function defaultEditableRule(id: string): Rule {
  return {
    id,
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
  };
}

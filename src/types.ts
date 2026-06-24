export type InputSource = "all" | "file" | "live";
export type MidiEventType = "noteOn" | "noteOff" | "both";
export type TriggerMode = "tap" | "hold" | "retrigger" | "chop";

export interface OctaveFold {
  enabled: boolean;
  minNote: number;
  maxNote: number;
}

export interface PlaybackSettings {
  speed: number;
  transpose: number;
  octaveFold: OctaveFold;
  globalDelayMs: number;
}

export interface VelocityRange {
  min: number;
  max: number;
}

export type NoteFilter =
  | { kind: "single"; value: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "list"; values: number[] };

export interface KeyOutput {
  keys: string[];
}

export interface Rule {
  id: string;
  enabled: boolean;
  name: string;
  inputSource: InputSource;
  eventType: MidiEventType;
  track: number | null;
  channel: number | null;
  note: NoteFilter;
  velocity: VelocityRange;
  output: KeyOutput;
  triggerMode: TriggerMode;
  pressDurationMs: number;
  retriggerGapMs: number;
  delayMs: number;
}

export interface Preset {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  playback: PlaybackSettings;
  rules: Rule[];
}

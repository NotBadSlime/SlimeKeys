export type InputSource = "all" | "file" | "live";
export type MidiEventType = "noteOn" | "noteOff" | "controlChange" | "both";
export type TriggerMode = "tap" | "hold" | "retrigger" | "chop";
export type HotkeyAction =
  | "play"
  | "pause"
  | "stop"
  | "next"
  | "previous"
  | "nextPreset"
  | "previousPreset"
  | "toggleKeyOutput"
  | "toggleAudition"
  | "speedDown"
  | "speedUp"
  | "toggleTrack1"
  | "toggleTrack2"
  | "toggleTrack3"
  | "toggleTrack4"
  | "toggleTrack5"
  | "toggleTrack6"
  | "toggleTrack7"
  | "toggleTrack8"
  | "toggleTrack9"
  | "releaseAll";
export type PlaylistPlaybackMode =
  | "sequential"
  | "repeatOne"
  | "repeatAll"
  | "shuffle";
export type PlaybackOutputMode = "keys" | "audition" | "both";
export type WorkspaceTab = "rules" | "score";

export interface HotkeyBinding {
  action: HotkeyAction;
  accelerator: string;
  enabled: boolean;
}

export interface SongEntry {
  path: string;
  name: string;
}

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
  keyOutputDelayMs: number;
  auditionDelayMs: number;
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

export interface MidiInputDevice {
  id: number;
  name: string;
  source: "winMm" | "windowsMidiServices";
  availableForLive: boolean;
  note: string | null;
}

export interface MidiEvent {
  inputSource: InputSource;
  eventType: Exclude<MidiEventType, "both">;
  track: number | null;
  channel: number;
  note: number;
  velocity: number;
  atMs: number;
}

export interface MidiNote {
  id: string;
  startMs: number;
  endMs: number;
  note: number;
  track: number | null;
  channel: number;
  velocity: number;
  selected: boolean;
}

export interface TrackSummary {
  track: number | null;
  key: string;
  noteCount: number;
  channels: number[];
  minNote: number;
  maxNote: number;
  firstNoteMs: number;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  playbackEnabled: boolean;
}

export interface PlaybackTrackState {
  track: number | null;
  enabled: boolean;
}

export interface ScoreEditorSnapshot {
  notes: MidiNote[];
  selectedNoteIds: string[];
}

export interface ScoreEditorState extends ScoreEditorSnapshot {
  clipboard: MidiNote[];
  undoStack: ScoreEditorSnapshot[];
  redoStack: ScoreEditorSnapshot[];
}

export type ScoreEditAction =
  | "selectAll"
  | "undo"
  | "redo"
  | "delete"
  | "copy"
  | "cut"
  | "paste"
  | "clearSelection"
  | "nudgeLeft"
  | "nudgeRight"
  | "transposeUp"
  | "transposeDown";

export interface MidiOutputDevice {
  id: number;
  name: string;
}

export interface AudioOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface StoredAudioOutput {
  followSystemDefault: boolean;
  deviceId: string | null;
}

export interface AppSnapshot {
  presets: Preset[];
  outputEnabled: boolean;
}

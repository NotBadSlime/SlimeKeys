use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputSource {
    All,
    File,
    Live,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MidiEventType {
    NoteOn,
    NoteOff,
    Both,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerMode {
    Tap,
    Hold,
    Retrigger,
    Chop,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub schema_version: u16,
    pub id: String,
    pub name: String,
    pub description: String,
    pub playback: PlaybackSettings,
    pub rules: Vec<Rule>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSettings {
    pub speed: f32,
    pub transpose: i8,
    pub octave_fold: OctaveFold,
    pub global_delay_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OctaveFold {
    pub enabled: bool,
    pub min_note: u8,
    pub max_note: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    pub input_source: InputSource,
    pub event_type: MidiEventType,
    pub track: Option<u16>,
    pub channel: Option<u8>,
    pub note: NoteFilter,
    pub velocity: VelocityRange,
    pub output: KeyOutput,
    pub trigger_mode: TriggerMode,
    pub press_duration_ms: u64,
    pub retrigger_gap_ms: u64,
    pub delay_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NoteFilter {
    Single { value: u8 },
    Range { min: u8, max: u8 },
    List { values: Vec<u8> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VelocityRange {
    pub min: u8,
    pub max: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyOutput {
    pub keys: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiEvent {
    pub input_source: InputSource,
    pub event_type: MidiEventType,
    pub track: Option<u16>,
    pub channel: u8,
    pub note: u8,
    pub velocity: u8,
    pub at_ms: u64,
}

impl MidiEvent {
    pub fn note_on(
        input_source: InputSource,
        track: Option<u16>,
        channel: u8,
        note: u8,
        velocity: u8,
        at_ms: u64,
    ) -> Self {
        Self {
            input_source,
            event_type: MidiEventType::NoteOn,
            track,
            channel,
            note,
            velocity,
            at_ms,
        }
    }

    pub fn note_off(
        input_source: InputSource,
        track: Option<u16>,
        channel: u8,
        note: u8,
        velocity: u8,
        at_ms: u64,
    ) -> Self {
        Self {
            input_source,
            event_type: MidiEventType::NoteOff,
            track,
            channel,
            note,
            velocity,
            at_ms,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyActionKind {
    Down,
    Up,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyAction {
    pub key: String,
    pub kind: KeyActionKind,
    pub at_ms: u64,
}

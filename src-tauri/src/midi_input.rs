use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiInputDevice {
    pub id: usize,
    pub name: String,
    pub source: MidiInputSource,
    pub available_for_live: bool,
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MidiInputSource {
    WinMm,
    WindowsMidiServices,
}

#[derive(Debug, Error)]
pub enum MidiInputError {
    #[error("failed to initialize MIDI input: {0}")]
    Init(String),
    #[error("failed to read MIDI input port name: {0}")]
    PortName(String),
}

pub fn list_midi_input_devices() -> Result<Vec<MidiInputDevice>, MidiInputError> {
    list_runtime_midi_input_devices()
}

fn list_runtime_midi_input_devices() -> Result<Vec<MidiInputDevice>, MidiInputError> {
    let input =
        midir::MidiInput::new("SlimeKeys").map_err(|err| MidiInputError::Init(err.to_string()))?;

    input
        .ports()
        .iter()
        .enumerate()
        .map(|(id, port)| {
            input
                .port_name(port)
                .map(|name| MidiInputDevice {
                    id,
                    name,
                    source: runtime_midi_input_source(),
                    available_for_live: true,
                    note: None,
                })
                .map_err(|err| MidiInputError::PortName(err.to_string()))
        })
        .collect()
}

#[cfg(windows)]
fn runtime_midi_input_source() -> MidiInputSource {
    MidiInputSource::WindowsMidiServices
}

#[cfg(not(windows))]
fn runtime_midi_input_source() -> MidiInputSource {
    MidiInputSource::WinMm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_input_device_list_is_queryable() {
        let devices = list_midi_input_devices().unwrap();
        assert!(devices.iter().all(|device| !device.name.trim().is_empty()));
    }

    #[test]
    fn midi_input_device_list_only_contains_live_capable_runtime_devices() {
        let devices = list_midi_input_devices().unwrap();
        assert!(
            devices.iter().all(|device| device.available_for_live),
            "device list should not include slow shell-scanned fallback devices: {devices:?}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn loopmidi_runtime_device_is_available_for_live_when_present() {
        let devices = list_midi_input_devices().unwrap();
        if let Some(loopmidi) = devices.iter().find(|device| {
            normalize_device_name(&device.name) == normalize_device_name("loopMIDI Port")
        }) {
            assert!(
                loopmidi.available_for_live,
                "loopMIDI Port was detected but is not available for Live: {devices:?}"
            );
        }
    }

    fn normalize_device_name(name: &str) -> String {
        name.trim().to_lowercase()
    }
}

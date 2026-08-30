use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiOutputDevice {
    pub id: usize,
    pub name: String,
}

#[derive(Debug, Error)]
pub enum MidiOutputError {
    #[error("failed to initialize MIDI output: {0}")]
    Init(String),
    #[error("failed to read MIDI output port name: {0}")]
    PortName(String),
    #[error("no MIDI output device found")]
    NoDevice,
    #[error("failed to open MIDI output: {0}")]
    Connect(String),
}

pub fn list_midi_output_devices() -> Result<Vec<MidiOutputDevice>, MidiOutputError> {
    let output = midir::MidiOutput::new("SlimeKeys")
        .map_err(|err| MidiOutputError::Init(err.to_string()))?;

    output
        .ports()
        .iter()
        .enumerate()
        .map(|(id, port)| {
            output
                .port_name(port)
                .map(|name| MidiOutputDevice { id, name })
                .map_err(|err| MidiOutputError::PortName(err.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_output_device_list_is_queryable() {
        let devices = list_midi_output_devices().unwrap();
        assert!(devices.iter().all(|device| !device.name.trim().is_empty()));
    }
}

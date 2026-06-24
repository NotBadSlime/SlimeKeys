use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiInputDevice {
    pub id: usize,
    pub name: String,
}

#[derive(Debug, Error)]
pub enum MidiInputError {
    #[error("failed to initialize MIDI input: {0}")]
    Init(String),
    #[error("failed to read MIDI input port name: {0}")]
    PortName(String),
}

pub fn list_midi_input_devices() -> Result<Vec<MidiInputDevice>, MidiInputError> {
    let input =
        midir::MidiInput::new("SlimeKeys").map_err(|err| MidiInputError::Init(err.to_string()))?;

    input
        .ports()
        .iter()
        .enumerate()
        .map(|(id, port)| {
            input
                .port_name(port)
                .map(|name| MidiInputDevice { id, name })
                .map_err(|err| MidiInputError::PortName(err.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_input_device_list_is_queryable() {
        let devices = list_midi_input_devices().unwrap();
        assert!(devices.iter().all(|device| !device.name.trim().is_empty()));
    }
}

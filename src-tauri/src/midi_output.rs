use std::{
    collections::BTreeMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
    thread,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    audition_engine::{dispatch_audition_events, MidiSynth, RustySynth},
    model::MidiEvent,
    playback_clock::PlaybackClock,
};

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

pub fn dispatch_midi_events(
    events: Vec<MidiEvent>,
    clock: Arc<PlaybackClock>,
    audition_delay_ms: u64,
    cancel: Arc<AtomicBool>,
    _release_on_cancel: Arc<AtomicBool>,
    audition_enabled: Arc<Mutex<bool>>,
    playback_tracks: Arc<Mutex<BTreeMap<Option<u16>, bool>>>,
) -> Result<Option<thread::JoinHandle<()>>, MidiOutputError> {
    let synth: Arc<Mutex<Box<dyn MidiSynth>>> = Arc::new(Mutex::new(Box::new(
        RustySynth::new(44100).map_err(|err| MidiOutputError::Init(err.to_string()))?,
    )));

    Ok(dispatch_audition_events(
        events,
        clock,
        audition_delay_ms,
        cancel,
        audition_enabled,
        playback_tracks,
        synth,
    ))
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

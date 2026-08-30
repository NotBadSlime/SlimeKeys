use std::sync::Arc;
use thiserror::Error;

const SOUNDFONT: &[u8] = include_bytes!("../resources/audition.sf2");

#[derive(Debug, Error)]
pub enum AuditionEngineError {
    #[error("failed to load audition soundfont: {0}")]
    SoundFont(String),
    #[error("failed to create audition synthesizer: {0}")]
    Synth(String),
}

pub trait MidiSynth: Send {
    fn note_on(&mut self, channel: u8, note: u8, velocity: u8);
    fn note_off(&mut self, channel: u8, note: u8);
    fn control_change(&mut self, channel: u8, controller: u8, value: u8);
    fn all_notes_off(&mut self);
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);
}

pub struct RustySynth {
    synthesizer: rustysynth::Synthesizer,
}

impl RustySynth {
    pub fn new(sample_rate: i32) -> Result<Self, AuditionEngineError> {
        let mut cursor = std::io::Cursor::new(SOUNDFONT);
        let sound_font = Arc::new(
            rustysynth::SoundFont::new(&mut cursor)
                .map_err(|err| AuditionEngineError::SoundFont(err.to_string()))?,
        );
        let settings = rustysynth::SynthesizerSettings::new(sample_rate.max(8000));
        let synthesizer = rustysynth::Synthesizer::new(&sound_font, &settings)
            .map_err(|err| AuditionEngineError::Synth(err.to_string()))?;
        Ok(Self { synthesizer })
    }
}

impl MidiSynth for RustySynth {
    fn note_on(&mut self, channel: u8, note: u8, velocity: u8) {
        self.synthesizer
            .note_on(channel as i32, note as i32, velocity as i32);
    }

    fn note_off(&mut self, channel: u8, note: u8) {
        self.synthesizer.note_off(channel as i32, note as i32);
    }

    fn control_change(&mut self, channel: u8, controller: u8, value: u8) {
        self.synthesizer.process_midi_message(
            channel as i32,
            0xB0,
            controller as i32,
            value as i32,
        );
    }

    fn all_notes_off(&mut self) {
        self.synthesizer.note_off_all(false);
        for channel in 0..16 {
            self.synthesizer.process_midi_message(channel, 0xB0, 123, 0);
            self.synthesizer.process_midi_message(channel, 0xB0, 120, 0);
        }
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.synthesizer.render(left, right);
    }
}

#[cfg(test)]
fn peak(buffer: &[f32]) -> f32 {
    buffer.iter().fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::MidiSynth;

    #[test]
    fn note_on_produces_non_silent_pcm() {
        let mut synth = RustySynth::new(44100).unwrap();
        synth.note_on(0, 60, 100);
        let mut left = vec![0.0; 2048];
        let mut right = vec![0.0; 2048];
        synth.render(&mut left, &mut right);
        assert!(peak(&left) > 0.001 || peak(&right) > 0.001);
    }

    #[test]
    fn all_notes_off_decays_toward_silence() {
        let mut synth = RustySynth::new(44100).unwrap();
        synth.note_on(0, 60, 100);
        let mut left = vec![0.0; 512];
        let mut right = vec![0.0; 512];
        synth.render(&mut left, &mut right);
        synth.all_notes_off();
        let mut silent = true;
        for _ in 0..64 {
            synth.render(&mut left, &mut right);
            silent = peak(&left) < 0.02 && peak(&right) < 0.02;
            if silent {
                break;
            }
        }
        assert!(silent);
    }
}

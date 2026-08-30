use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

use crate::model::{MidiEvent, MidiEventType};
use crate::playback_clock::PlaybackClock;

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

pub(crate) fn track_allowed(filter: &BTreeMap<Option<u16>, bool>, track: Option<u16>) -> bool {
    filter.get(&track).copied().unwrap_or(true)
}

pub(crate) fn midi_message_for_event(event: &MidiEvent) -> Option<[u8; 3]> {
    let channel = event.channel.checked_sub(1)?.min(15);
    let status = match event.event_type {
        MidiEventType::NoteOn if event.velocity > 0 => 0x90,
        MidiEventType::NoteOn | MidiEventType::NoteOff => 0x80,
        MidiEventType::ControlChange => 0xB0,
        MidiEventType::Both => return None,
    };

    Some([
        status | channel,
        event.note.min(127),
        event.velocity.min(127),
    ])
}

pub(crate) fn apply_midi_event(
    synth: &mut dyn MidiSynth,
    event: &MidiEvent,
    enabled: bool,
    track_allowed: bool,
) {
    if !enabled {
        return;
    }
    if !track_allowed && event.event_type != MidiEventType::NoteOff {
        return;
    }
    let Some(message) = midi_message_for_event(event) else {
        return;
    };
    let channel = message[0] & 0x0F;
    match event.event_type {
        MidiEventType::NoteOn if event.velocity > 0 => {
            synth.note_on(channel, message[1], message[2]);
        }
        MidiEventType::NoteOn | MidiEventType::NoteOff => {
            synth.note_off(channel, message[1]);
        }
        MidiEventType::ControlChange => {
            synth.control_change(channel, message[1], message[2]);
        }
        MidiEventType::Both => {}
    }
}

pub fn dispatch_audition_events(
    events: Vec<MidiEvent>,
    clock: Arc<PlaybackClock>,
    audition_delay_ms: u64,
    cancel: Arc<AtomicBool>,
    audition_enabled: Arc<Mutex<bool>>,
    playback_tracks: Arc<Mutex<BTreeMap<Option<u16>, bool>>>,
    synth: Arc<Mutex<Box<dyn MidiSynth>>>,
) -> Option<thread::JoinHandle<()>> {
    if events.is_empty() {
        return None;
    }

    Some(thread::spawn(move || {
        let mut next_index = 0;
        let mut pending_events: VecDeque<(Instant, MidiEvent)> = VecDeque::new();
        let mut was_enabled = audition_is_enabled(&audition_enabled);

        while !cancel.load(Ordering::SeqCst) {
            let enabled = audition_is_enabled(&audition_enabled);
            if was_enabled && !enabled {
                silence_synth(&synth);
            }
            was_enabled = enabled;

            let now = Instant::now();
            let position_ms = clock.position_ms();
            while next_index < events.len() && events[next_index].at_ms as f64 <= position_ms {
                pending_events.push_back((
                    now + Duration::from_millis(audition_delay_ms),
                    events[next_index].clone(),
                ));
                next_index += 1;
            }

            loop {
                let ready = pending_events
                    .front()
                    .map(|(due_at, _)| *due_at <= Instant::now())
                    .unwrap_or(false);
                if !ready {
                    break;
                }

                let Some((_, event)) = pending_events.pop_front() else {
                    break;
                };

                let enabled = audition_is_enabled(&audition_enabled);
                if was_enabled && !enabled {
                    silence_synth(&synth);
                }
                was_enabled = enabled;

                let allowed = playback_tracks
                    .lock()
                    .map(|tracks| track_allowed(&tracks, event.track))
                    .unwrap_or(true);

                if let Ok(mut synth) = synth.lock() {
                    apply_midi_event(&mut **synth, &event, enabled, allowed);
                }
            }

            if next_index >= events.len() && pending_events.is_empty() {
                break;
            }

            thread::sleep(
                pending_events
                    .front()
                    .map(|(due_at, _)| due_at.saturating_duration_since(Instant::now()))
                    .unwrap_or_else(|| Duration::from_millis(1))
                    .min(Duration::from_millis(1)),
            );
        }

        silence_synth(&synth);
    }))
}

fn audition_is_enabled(audition_enabled: &Arc<Mutex<bool>>) -> bool {
    audition_enabled
        .lock()
        .map(|enabled| *enabled)
        .unwrap_or(false)
}

fn silence_synth(synth: &Arc<Mutex<Box<dyn MidiSynth>>>) {
    if let Ok(mut synth) = synth.lock() {
        synth.all_notes_off();
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
    use crate::model::InputSource;

    struct RecordingSynth {
        active: u32,
        rendered_peak: f32,
    }

    impl MidiSynth for RecordingSynth {
        fn note_on(&mut self, _channel: u8, _note: u8, _velocity: u8) {
            self.active += 1;
        }
        fn note_off(&mut self, _channel: u8, _note: u8) {
            self.active = self.active.saturating_sub(1);
        }
        fn control_change(&mut self, _channel: u8, _controller: u8, _value: u8) {}
        fn all_notes_off(&mut self) {
            self.active = 0;
        }
        fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
            let sample = if self.active > 0 { 0.2 } else { 0.0 };
            self.rendered_peak = self.rendered_peak.max(sample);
            for value in left.iter_mut().chain(right.iter_mut()) {
                *value = sample;
            }
        }
    }

    #[test]
    fn midi_message_uses_channel_note_and_velocity() {
        let message = midi_message_for_event(&MidiEvent::note_on(
            InputSource::File,
            Some(0),
            2,
            64,
            90,
            0,
        ))
        .unwrap();

        assert_eq!(message, [0x91, 64, 90]);
    }

    #[test]
    fn midi_message_preserves_control_change_events() {
        let message = midi_message_for_event(&MidiEvent::control_change(
            InputSource::File,
            Some(0),
            1,
            64,
            127,
            0,
        ))
        .unwrap();

        assert_eq!(message, [0xB0, 64, 127]);
    }

    #[test]
    fn track_filter_defaults_to_enabled_for_unknown_tracks() {
        let mut filter = BTreeMap::new();
        filter.insert(Some(1), false);

        assert!(!track_allowed(&filter, Some(1)));
        assert!(track_allowed(&filter, Some(2)));
        assert!(track_allowed(&filter, None));
    }

    #[test]
    fn apply_midi_event_enabled_note_on_increases_active() {
        let mut synth = RecordingSynth {
            active: 0,
            rendered_peak: 0.0,
        };
        let event = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 0);
        apply_midi_event(&mut synth, &event, true, true);
        assert_eq!(synth.active, 1);
    }

    #[test]
    fn apply_midi_event_disabled_note_on_does_not_increase_active() {
        let mut synth = RecordingSynth {
            active: 0,
            rendered_peak: 0.0,
        };
        let event = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 0);
        apply_midi_event(&mut synth, &event, false, true);
        assert_eq!(synth.active, 0);
    }

    #[test]
    fn apply_midi_event_muted_track_skips_note_on_but_applies_note_off() {
        let mut synth = RecordingSynth {
            active: 1,
            rendered_peak: 0.0,
        };
        let note_on = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 0);
        apply_midi_event(&mut synth, &note_on, true, false);
        assert_eq!(synth.active, 1);

        let note_off = MidiEvent::note_off(InputSource::File, Some(0), 1, 60, 0, 0);
        apply_midi_event(&mut synth, &note_off, true, false);
        assert_eq!(synth.active, 0);
    }

    #[test]
    fn apply_midi_event_all_notes_off_zeros_active() {
        let mut synth = RecordingSynth {
            active: 3,
            rendered_peak: 0.0,
        };
        synth.all_notes_off();
        assert_eq!(synth.active, 0);
    }

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

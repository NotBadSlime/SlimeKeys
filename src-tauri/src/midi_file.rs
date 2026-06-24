use crate::model::{InputSource, MidiEvent, MidiEventType};
use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MidiFileError {
    #[error("failed to parse MIDI file: {0}")]
    Parse(#[from] midly::Error),
    #[error("SMPTE timecode MIDI files are not supported yet")]
    UnsupportedTimecode,
}

pub fn parse_midi_bytes(bytes: &[u8]) -> Result<Vec<MidiEvent>, MidiFileError> {
    let smf = Smf::parse(bytes)?;
    let ticks_per_quarter = match smf.header.timing {
        Timing::Metrical(ticks) => ticks.as_int() as u64,
        Timing::Timecode(_, _) => return Err(MidiFileError::UnsupportedTimecode),
    };

    let mut events = Vec::new();

    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut elapsed_us = 0_u64;
        let mut tempo_us_per_quarter = 500_000_u64;

        for event in track {
            let delta_ticks = event.delta.as_int() as u64;
            elapsed_us += delta_ticks * tempo_us_per_quarter / ticks_per_quarter;
            let at_ms = elapsed_us / 1_000;

            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(tempo)) => {
                    tempo_us_per_quarter = tempo.as_int() as u64;
                }
                TrackEventKind::Midi { channel, message } => match message {
                    MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                        events.push(MidiEvent::note_on(
                            InputSource::File,
                            Some(track_index as u16),
                            channel.as_int() + 1,
                            key.as_int(),
                            vel.as_int(),
                            at_ms,
                        ));
                    }
                    MidiMessage::NoteOn { key, vel } => {
                        events.push(MidiEvent::note_off(
                            InputSource::File,
                            Some(track_index as u16),
                            channel.as_int() + 1,
                            key.as_int(),
                            vel.as_int(),
                            at_ms,
                        ));
                    }
                    MidiMessage::NoteOff { key, vel } => {
                        events.push(MidiEvent::note_off(
                            InputSource::File,
                            Some(track_index as u16),
                            channel.as_int() + 1,
                            key.as_int(),
                            vel.as_int(),
                            at_ms,
                        ));
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    }

    events.sort_by_key(|event| {
        (
            event.at_ms,
            event.track.unwrap_or(u16::MAX),
            match event.event_type {
                MidiEventType::NoteOff => 0,
                MidiEventType::NoteOn => 1,
                MidiEventType::Both => 2,
            },
        )
    });

    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MidiEventType;

    #[test]
    fn parses_simple_note_on_and_note_off_events() {
        let events = parse_midi_bytes(&simple_midi_bytes()).unwrap();

        let note_on = events
            .iter()
            .find(|event| event.event_type == MidiEventType::NoteOn && event.note == 60)
            .unwrap();
        let note_off = events
            .iter()
            .find(|event| event.event_type == MidiEventType::NoteOff && event.note == 60)
            .unwrap();

        assert_eq!(note_on.at_ms, 0);
        assert_eq!(note_off.at_ms, 500);
    }

    fn simple_midi_bytes() -> Vec<u8> {
        vec![
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            12, 0, 0x90, 60, 64, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
        ]
    }
}

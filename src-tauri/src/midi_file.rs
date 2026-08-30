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

#[derive(Clone, Copy, Debug)]
struct TempoChange {
    tick: u64,
    us_per_quarter: u64,
}

#[derive(Clone, Debug)]
struct TimedMidiEvent {
    tick: u64,
    event: MidiEvent,
}

pub fn parse_midi_bytes(bytes: &[u8]) -> Result<Vec<MidiEvent>, MidiFileError> {
    let smf = Smf::parse(bytes)?;
    let ticks_per_quarter = match smf.header.timing {
        Timing::Metrical(ticks) => ticks.as_int() as u64,
        Timing::Timecode(_, _) => return Err(MidiFileError::UnsupportedTimecode),
    };

    let tempo_changes = collect_tempo_changes(&smf);
    let mut timed_events = Vec::new();

    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut elapsed_ticks = 0_u64;

        for event in track {
            let delta_ticks = event.delta.as_int() as u64;
            elapsed_ticks += delta_ticks;

            match event.kind {
                TrackEventKind::Midi { channel, message } => match message {
                    MidiMessage::NoteOn { key, vel } if vel.as_int() > 0 => {
                        timed_events.push(TimedMidiEvent {
                            tick: elapsed_ticks,
                            event: MidiEvent::note_on(
                                InputSource::File,
                                Some(track_index as u16),
                                channel.as_int() + 1,
                                key.as_int(),
                                vel.as_int(),
                                0,
                            ),
                        });
                    }
                    MidiMessage::NoteOn { key, vel } => {
                        timed_events.push(TimedMidiEvent {
                            tick: elapsed_ticks,
                            event: MidiEvent::note_off(
                                InputSource::File,
                                Some(track_index as u16),
                                channel.as_int() + 1,
                                key.as_int(),
                                vel.as_int(),
                                0,
                            ),
                        });
                    }
                    MidiMessage::NoteOff { key, vel } => {
                        timed_events.push(TimedMidiEvent {
                            tick: elapsed_ticks,
                            event: MidiEvent::note_off(
                                InputSource::File,
                                Some(track_index as u16),
                                channel.as_int() + 1,
                                key.as_int(),
                                vel.as_int(),
                                0,
                            ),
                        });
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    }

    let mut events = timed_events
        .into_iter()
        .map(|timed_event| {
            let mut event = timed_event.event;
            event.at_ms =
                ticks_to_microseconds(timed_event.tick, ticks_per_quarter, &tempo_changes) / 1_000;
            event
        })
        .collect::<Vec<_>>();

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

fn collect_tempo_changes(smf: &Smf<'_>) -> Vec<TempoChange> {
    let mut changes = vec![TempoChange {
        tick: 0,
        us_per_quarter: 500_000,
    }];

    for track in &smf.tracks {
        let mut elapsed_ticks = 0_u64;
        for event in track {
            elapsed_ticks += event.delta.as_int() as u64;
            if let TrackEventKind::Meta(MetaMessage::Tempo(tempo)) = event.kind {
                changes.push(TempoChange {
                    tick: elapsed_ticks,
                    us_per_quarter: tempo.as_int() as u64,
                });
            }
        }
    }

    changes.sort_by_key(|change| change.tick);
    changes
}

fn ticks_to_microseconds(tick: u64, ticks_per_quarter: u64, tempo_changes: &[TempoChange]) -> u64 {
    let mut elapsed_us = 0_u64;
    let mut last_tick = 0_u64;
    let mut tempo_us_per_quarter = 500_000_u64;

    for change in tempo_changes {
        if change.tick > tick {
            break;
        }
        elapsed_us += (change.tick - last_tick) * tempo_us_per_quarter / ticks_per_quarter;
        last_tick = change.tick;
        tempo_us_per_quarter = change.us_per_quarter;
    }

    elapsed_us + (tick - last_tick) * tempo_us_per_quarter / ticks_per_quarter
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

    #[test]
    fn applies_tempo_track_to_notes_on_other_tracks() {
        let events = parse_midi_bytes(&split_tempo_track_midi_bytes()).unwrap();

        let note_off = events
            .iter()
            .find(|event| event.event_type == MidiEventType::NoteOff && event.note == 60)
            .unwrap();

        assert_eq!(note_off.at_ms, 1000);
    }

    fn simple_midi_bytes() -> Vec<u8> {
        vec![
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            12, 0, 0x90, 60, 64, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
        ]
    }

    fn split_tempo_track_midi_bytes() -> Vec<u8> {
        vec![
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 1, 0, 2, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            11, 0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0, 0xff, 0x2f, 0, b'M', b'T', b'r', b'k', 0, 0,
            0, 12, 0, 0x90, 60, 64, 96, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
        ]
    }
}

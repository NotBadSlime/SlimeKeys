use crate::model::{
    InputSource, KeyOutput, MidiEventType, NoteFilter, OctaveFold, PlaybackSettings, Preset, Rule,
    TriggerMode, VelocityRange,
};

pub fn genshin_21_key_preset() -> Preset {
    let mappings = [
        ("C3", 48, "Z"),
        ("D3", 50, "X"),
        ("E3", 52, "C"),
        ("F3", 53, "V"),
        ("G3", 55, "B"),
        ("A3", 57, "N"),
        ("B3", 59, "M"),
        ("C4", 60, "A"),
        ("D4", 62, "S"),
        ("E4", 64, "D"),
        ("F4", 65, "F"),
        ("G4", 67, "G"),
        ("A4", 69, "H"),
        ("B4", 71, "J"),
        ("C5", 72, "Q"),
        ("D5", 74, "W"),
        ("E5", 76, "E"),
        ("F5", 77, "R"),
        ("G5", 79, "T"),
        ("A5", 81, "Y"),
        ("B5", 83, "U"),
    ];

    Preset {
        schema_version: 1,
        id: "genshin-21-key".to_string(),
        name: "Genshin 21-Key".to_string(),
        description: "Default 21-key game instrument mapping.".to_string(),
        playback: PlaybackSettings {
            speed: 1.0,
            transpose: 0,
            octave_fold: OctaveFold {
                enabled: false,
                min_note: 48,
                max_note: 83,
            },
            global_delay_ms: 0,
        },
        rules: mappings
            .into_iter()
            .map(|(note_name, note, key)| Rule {
                id: format!("{}-to-{}", note_name.to_lowercase(), key.to_lowercase()),
                enabled: true,
                name: format!("{note_name} -> {key}"),
                input_source: InputSource::All,
                event_type: MidiEventType::Both,
                track: None,
                channel: None,
                note: NoteFilter::Single { value: note },
                velocity: VelocityRange { min: 1, max: 127 },
                output: KeyOutput {
                    keys: vec![key.to_string()],
                },
                trigger_mode: TriggerMode::Retrigger,
                press_duration_ms: 35,
                retrigger_gap_ms: 12,
                delay_ms: 0,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{MidiEventType, NoteFilter, TriggerMode};

    #[test]
    fn genshin_default_has_twenty_one_retrigger_rules_for_both_events() {
        let preset = genshin_21_key_preset();
        assert_eq!(preset.rules.len(), 21);
        assert!(preset.rules.iter().all(|rule| {
            rule.trigger_mode == TriggerMode::Retrigger
                && rule.event_type == MidiEventType::Both
        }));
    }

    #[test]
    fn genshin_default_maps_c3_to_z_and_b5_to_u() {
        let preset = genshin_21_key_preset();
        let c3 = preset
            .rules
            .iter()
            .find(|rule| rule.name == "C3 -> Z")
            .unwrap();
        let b5 = preset
            .rules
            .iter()
            .find(|rule| rule.name == "B5 -> U")
            .unwrap();

        assert_eq!(c3.note, NoteFilter::Single { value: 48 });
        assert_eq!(c3.output.keys, vec!["Z"]);
        assert_eq!(b5.note, NoteFilter::Single { value: 83 });
        assert_eq!(b5.output.keys, vec!["U"]);
    }
}

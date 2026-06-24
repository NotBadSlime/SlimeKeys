use std::collections::{BTreeMap, BTreeSet};

use crate::model::{
    InputSource, KeyAction, KeyActionKind, MidiEvent, MidiEventType, NoteFilter, Preset, Rule,
    TriggerMode,
};

#[derive(Clone, Debug, Default)]
pub struct TriggerState {
    held_keys: BTreeSet<String>,
    chop_starts: BTreeMap<String, u64>,
}

impl TriggerState {
    pub fn mark_down(&mut self, key: &str) {
        self.held_keys.insert(key.to_string());
    }

    pub fn mark_up(&mut self, key: &str) {
        self.held_keys.remove(key);
    }

    pub fn is_down(&self, key: &str) -> bool {
        self.held_keys.contains(key)
    }

    pub fn held_keys(&self) -> impl Iterator<Item = &str> {
        self.held_keys.iter().map(String::as_str)
    }

    fn mark_chop_start(&mut self, key: &str, at_ms: u64) {
        self.chop_starts.insert(key.to_string(), at_ms);
    }

    fn take_chop_start(&mut self, key: &str) -> Option<u64> {
        self.chop_starts.remove(key)
    }
}

pub fn matching_rules<'a>(preset: &'a Preset, event: &MidiEvent) -> Vec<&'a Rule> {
    preset
        .rules
        .iter()
        .filter(|rule| rule_matches(rule, event))
        .collect()
}

pub fn rule_matches(rule: &Rule, event: &MidiEvent) -> bool {
    rule.enabled
        && source_matches(&rule.input_source, &event.input_source)
        && event_type_matches(rule, event)
        && rule.track.map_or(true, |track| Some(track) == event.track)
        && rule
            .channel
            .map_or(true, |channel| channel == event.channel)
        && note_matches(&rule.note, event.note)
        && velocity_matches(rule, event)
}

pub fn actions_for_rule(
    rule: &Rule,
    event: &MidiEvent,
    state: &mut TriggerState,
) -> Vec<KeyAction> {
    match rule.trigger_mode {
        TriggerMode::Tap => tap_actions(rule, event),
        TriggerMode::Hold => hold_actions(rule, event, state),
        TriggerMode::Retrigger => retrigger_actions(rule, event, state),
        TriggerMode::Chop => chop_actions(rule, event, state),
    }
}

fn source_matches(rule_source: &InputSource, event_source: &InputSource) -> bool {
    *rule_source == InputSource::All || rule_source == event_source
}

fn event_type_matches(rule: &Rule, event: &MidiEvent) -> bool {
    match rule.event_type {
        MidiEventType::Both => true,
        expected if expected == event.event_type => true,
        MidiEventType::NoteOn
            if event.event_type == MidiEventType::NoteOff
                && matches!(
                    rule.trigger_mode,
                    TriggerMode::Hold | TriggerMode::Retrigger | TriggerMode::Chop
                ) =>
        {
            true
        }
        _ => false,
    }
}

fn note_matches(filter: &NoteFilter, note: u8) -> bool {
    match filter {
        NoteFilter::Single { value } => *value == note,
        NoteFilter::Range { min, max } => (*min..=*max).contains(&note),
        NoteFilter::List { values } => values.contains(&note),
    }
}

fn velocity_matches(rule: &Rule, event: &MidiEvent) -> bool {
    event.event_type == MidiEventType::NoteOff
        || (rule.velocity.min..=rule.velocity.max).contains(&event.velocity)
}

fn tap_actions(rule: &Rule, event: &MidiEvent) -> Vec<KeyAction> {
    if event.event_type != MidiEventType::NoteOn {
        return Vec::new();
    }

    let base = event.at_ms + rule.delay_ms;
    let release_at = base + rule.press_duration_ms;
    let mut actions = Vec::with_capacity(rule.output.keys.len() * 2);

    for key in &rule.output.keys {
        actions.push(key_action(key, KeyActionKind::Down, base));
    }
    for key in &rule.output.keys {
        actions.push(key_action(key, KeyActionKind::Up, release_at));
    }

    actions
}

fn chop_actions(rule: &Rule, event: &MidiEvent, state: &mut TriggerState) -> Vec<KeyAction> {
    let base = event.at_ms + rule.delay_ms;
    match event.event_type {
        MidiEventType::NoteOn => {
            for key in &rule.output.keys {
                state.mark_chop_start(key, base);
            }
            tap_actions(rule, event)
        }
        MidiEventType::NoteOff => {
            let mut actions = Vec::new();
            let interval = rule.retrigger_gap_ms.max(1);
            for key in &rule.output.keys {
                if let Some(start) = state.take_chop_start(key) {
                    let mut at_ms = start + interval;
                    while at_ms < base {
                        actions.push(key_action(key, KeyActionKind::Down, at_ms));
                        actions.push(key_action(
                            key,
                            KeyActionKind::Up,
                            at_ms + rule.press_duration_ms,
                        ));
                        at_ms += interval;
                    }
                }
            }
            actions
        }
        MidiEventType::Both => Vec::new(),
    }
}

fn hold_actions(rule: &Rule, event: &MidiEvent, state: &mut TriggerState) -> Vec<KeyAction> {
    let base = event.at_ms + rule.delay_ms;
    match event.event_type {
        MidiEventType::NoteOn => rule
            .output
            .keys
            .iter()
            .map(|key| {
                state.mark_down(key);
                key_action(key, KeyActionKind::Down, base)
            })
            .collect(),
        MidiEventType::NoteOff => rule
            .output
            .keys
            .iter()
            .filter_map(|key| {
                if state.is_down(key) {
                    state.mark_up(key);
                    Some(key_action(key, KeyActionKind::Up, base))
                } else {
                    None
                }
            })
            .collect(),
        MidiEventType::Both => Vec::new(),
    }
}

fn retrigger_actions(rule: &Rule, event: &MidiEvent, state: &mut TriggerState) -> Vec<KeyAction> {
    let base = event.at_ms + rule.delay_ms;
    match event.event_type {
        MidiEventType::NoteOn => {
            let mut actions = Vec::new();
            for key in &rule.output.keys {
                if state.is_down(key) {
                    actions.push(key_action(key, KeyActionKind::Up, base));
                    actions.push(key_action(
                        key,
                        KeyActionKind::Down,
                        base + rule.retrigger_gap_ms,
                    ));
                } else {
                    actions.push(key_action(key, KeyActionKind::Down, base));
                }
                state.mark_down(key);
            }
            actions
        }
        MidiEventType::NoteOff => hold_actions(rule, event, state),
        MidiEventType::Both => Vec::new(),
    }
}

fn key_action(key: &str, kind: KeyActionKind, at_ms: u64) -> KeyAction {
    KeyAction {
        key: key.to_string(),
        kind,
        at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        InputSource, KeyActionKind, KeyOutput, MidiEvent, MidiEventType, NoteFilter, Rule,
        TriggerMode, VelocityRange,
    };

    #[test]
    fn rule_matches_note_on_channel_note_and_velocity() {
        let rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Tap);
        let event = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 100);

        assert!(rule_matches(&rule, &event));
    }

    #[test]
    fn tap_generates_down_and_up_ignoring_note_off() {
        let mut state = TriggerState::default();
        let rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Tap);
        let event = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 100);

        let actions = actions_for_rule(&rule, &event, &mut state);

        assert_eq!(
            actions.iter().map(|action| action.kind).collect::<Vec<_>>(),
            vec![KeyActionKind::Down, KeyActionKind::Up]
        );
        assert_eq!(actions[1].at_ms, 135);
    }

    #[test]
    fn hold_pairs_note_on_and_note_off() {
        let mut state = TriggerState::default();
        let rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Hold);
        let note_on = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 100);
        let note_off = MidiEvent::note_off(InputSource::File, Some(0), 1, 60, 0, 280);

        let down = actions_for_rule(&rule, &note_on, &mut state);
        let up = actions_for_rule(&rule, &note_off, &mut state);

        assert_eq!(down[0].kind, KeyActionKind::Down);
        assert_eq!(up[0].kind, KeyActionKind::Up);
        assert!(!state.is_down("A"));
    }

    #[test]
    fn retrigger_releases_before_repressing_held_key() {
        let mut state = TriggerState::default();
        state.mark_down("A");
        let rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Retrigger);
        let event = MidiEvent::note_on(InputSource::Live, None, 1, 60, 90, 200);

        let actions = actions_for_rule(&rule, &event, &mut state);

        assert_eq!(
            actions.iter().map(|action| action.kind).collect::<Vec<_>>(),
            vec![KeyActionKind::Up, KeyActionKind::Down]
        );
        assert_eq!(actions[1].at_ms, 212);
    }

    #[test]
    fn chop_splits_long_note_into_repeated_taps() {
        let mut state = TriggerState::default();
        let mut rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Chop);
        rule.press_duration_ms = 20;
        rule.retrigger_gap_ms = 80;
        let note_on = MidiEvent::note_on(InputSource::File, Some(0), 1, 60, 90, 100);
        let note_off = MidiEvent::note_off(InputSource::File, Some(0), 1, 60, 0, 300);

        let first = actions_for_rule(&rule, &note_on, &mut state);
        let rest = actions_for_rule(&rule, &note_off, &mut state);

        assert_eq!(
            first.iter().map(|action| action.at_ms).collect::<Vec<_>>(),
            vec![100, 120]
        );
        assert_eq!(
            rest.iter().map(|action| action.at_ms).collect::<Vec<_>>(),
            vec![180, 200, 260, 280]
        );
    }

    fn test_rule(note: NoteFilter, trigger_mode: TriggerMode) -> Rule {
        Rule {
            id: "test-rule".to_string(),
            enabled: true,
            name: "Test Rule".to_string(),
            input_source: InputSource::All,
            event_type: MidiEventType::NoteOn,
            track: Some(0),
            channel: Some(1),
            note,
            velocity: VelocityRange { min: 1, max: 127 },
            output: KeyOutput {
                keys: vec!["A".to_string()],
            },
            trigger_mode,
            press_duration_ms: 35,
            retrigger_gap_ms: 12,
            delay_ms: 0,
        }
    }
}

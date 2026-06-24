# SlimeKeys Initial App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable SlimeKeys Windows desktop app with a Tauri/React UI, Rust MIDI/rule/keyboard backend, default Genshin preset, and automated tests for the core translation behavior.

**Architecture:** The React frontend renders presets, input controls, a rule table, and logs. The Rust backend owns presets, MIDI normalization, rule matching, trigger-mode action generation, MIDI file parsing, live MIDI device listing, and Windows keyboard output behind a testable interface. Tauri commands bridge the frontend and backend.

**Tech Stack:** Tauri 2, React, TypeScript, Vite, Vitest, Rust, Serde, Midly, Midir, Windows API.

---

## File Structure

- `package.json`: npm scripts and frontend dependencies.
- `index.html`, `vite.config.ts`, `tsconfig*.json`: Vite/TypeScript setup.
- `src/main.tsx`: React entrypoint.
- `src/App.tsx`: main application shell.
- `src/styles.css`: desktop UI styling.
- `src/types.ts`: frontend mirror of preset/rule/status types.
- `src/lib/presets.ts`: frontend helpers for presets.
- `src/lib/presets.test.ts`: Vitest coverage for frontend preset helper behavior.
- `src-tauri/Cargo.toml`: Rust app dependencies.
- `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`: Tauri bootstrap.
- `src-tauri/src/lib.rs`: Tauri command registration and shared app state.
- `src-tauri/src/model.rs`: preset, rule, MIDI event, and keyboard action models.
- `src-tauri/src/presets.rs`: default Genshin preset and preset validation.
- `src-tauri/src/rule_engine.rs`: rule matching and trigger-mode action generation.
- `src-tauri/src/midi_file.rs`: MIDI file parser from `.mid/.midi` into normalized events.
- `src-tauri/src/midi_input.rs`: live MIDI input device listing.
- `src-tauri/src/keyboard.rs`: keyboard output trait, tracked output, and Windows implementation.
- `src-tauri/src/commands.rs`: Tauri commands called by the frontend.

---

### Task 1: Scaffold Tauri, React, And Test Tooling

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/types.ts`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add project manifests and base app files**

Create a Vite React TypeScript app and Tauri 2 Rust crate. Use these scripts:

```json
{
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 1420",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

The initial React app must render the app title, left preset panel, top input controls, central rule table area, and bottom log area.

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies install without errors and create `package-lock.json`.

- [ ] **Step 3: Verify scaffold**

Run:

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: frontend TypeScript build passes and Rust crate checks.

- [ ] **Step 4: Commit scaffold**

Run:

```powershell
git add package.json package-lock.json index.html vite.config.ts tsconfig.json tsconfig.node.json src src-tauri docs/superpowers/plans/2026-06-25-slimekeys-implementation.md
git commit -m "chore: scaffold Tauri React app"
```

---

### Task 2: Implement Preset Model And Default Genshin Preset With Tests

**Files:**
- Create: `src-tauri/src/model.rs`
- Create: `src-tauri/src/presets.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/presets.rs`:

```rust
#[test]
fn genshin_default_has_twenty_one_tap_rules() {
    let preset = genshin_21_key_preset();
    assert_eq!(preset.rules.len(), 21);
    assert!(preset.rules.iter().all(|rule| rule.trigger_mode == TriggerMode::Tap));
}

#[test]
fn genshin_default_maps_c3_to_z_and_b5_to_u() {
    let preset = genshin_21_key_preset();
    let c3 = preset.rules.iter().find(|rule| rule.name == "C3 -> Z").unwrap();
    let b5 = preset.rules.iter().find(|rule| rule.name == "B5 -> U").unwrap();
    assert_eq!(c3.note, NoteFilter::Single { value: 48 });
    assert_eq!(c3.output.keys, vec!["Z"]);
    assert_eq!(b5.note, NoteFilter::Single { value: 83 });
    assert_eq!(b5.output.keys, vec!["U"]);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml genshin_default -- --nocapture
```

Expected: FAIL because `genshin_21_key_preset` and model types do not exist yet.

- [ ] **Step 3: Implement model and preset**

Create serializable Rust enums/structs for `Preset`, `PlaybackSettings`, `OctaveFold`, `Rule`, `InputSource`, `MidiEventType`, `NoteFilter`, `VelocityRange`, `KeyOutput`, and `TriggerMode`. Implement `genshin_21_key_preset()` with the 21 mappings from C3-B5 to `Z X C V B N M`, `A S D F G H J`, `Q W E R T Y U`, using `Tap`, `press_duration_ms = 35`, `retrigger_gap_ms = 12`, and velocity `1..=127`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml genshin_default -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit preset model**

Run:

```powershell
git add src-tauri/src/model.rs src-tauri/src/presets.rs src-tauri/src/lib.rs
git commit -m "feat: add preset model and default mapping"
```

---

### Task 3: Implement Rule Matching And Trigger Modes With Tests

**Files:**
- Create: `src-tauri/src/rule_engine.rs`
- Modify: `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/rule_engine.rs`:

```rust
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
    assert_eq!(actions.iter().map(|a| a.kind).collect::<Vec<_>>(), vec![KeyActionKind::Down, KeyActionKind::Up]);
    assert_eq!(actions[1].at_ms, 135);
}

#[test]
fn retrigger_releases_before_repressing_held_key() {
    let mut state = TriggerState::default();
    state.mark_down("A");
    let rule = test_rule(NoteFilter::Single { value: 60 }, TriggerMode::Retrigger);
    let event = MidiEvent::note_on(InputSource::Live, None, 1, 60, 90, 200);
    let actions = actions_for_rule(&rule, &event, &mut state);
    assert_eq!(actions.iter().map(|a| a.kind).collect::<Vec<_>>(), vec![KeyActionKind::Up, KeyActionKind::Down]);
    assert_eq!(actions[1].at_ms, 212);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml rule_ -- --nocapture
```

Expected: FAIL because the rule engine does not exist yet.

- [ ] **Step 3: Implement rule engine**

Implement:

- `rule_matches(rule, event) -> bool`
- `matching_rules(preset, event) -> Vec<&Rule>`
- `actions_for_rule(rule, event, state) -> Vec<KeyAction>`
- `TriggerState` tracking keys held by SlimeKeys
- Tap, Hold, Retrigger, and Chop action generation

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml rule_ tap_ retrigger_ -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit rule engine**

Run:

```powershell
git add src-tauri/src/model.rs src-tauri/src/rule_engine.rs src-tauri/src/lib.rs
git commit -m "feat: add rule engine trigger modes"
```

---

### Task 4: Implement MIDI File Parsing And Live Device Listing

**Files:**
- Create: `src-tauri/src/midi_file.rs`
- Create: `src-tauri/src/midi_input.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/midi_file.rs`:

```rust
#[test]
fn parses_simple_note_on_and_note_off_events() {
    let bytes = simple_midi_bytes();
    let events = parse_midi_bytes(&bytes).unwrap();
    assert!(events.iter().any(|event| event.event_type == MidiEventType::NoteOn && event.note == 60));
    assert!(events.iter().any(|event| event.event_type == MidiEventType::NoteOff && event.note == 60));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml parses_simple_note -- --nocapture
```

Expected: FAIL because `parse_midi_bytes` does not exist yet.

- [ ] **Step 3: Implement MIDI parser and input listing**

Use `midly` to parse SMF bytes into normalized `MidiEvent` values with source `InputSource::File`, track index, channel, note, velocity, and absolute time in milliseconds. Use `midir` to list live MIDI input port names.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml parses_simple_note -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit MIDI modules**

Run:

```powershell
git add src-tauri/src/midi_file.rs src-tauri/src/midi_input.rs src-tauri/src/lib.rs
git commit -m "feat: add MIDI parsing and device listing"
```

---

### Task 5: Implement Keyboard Output Safety Layer

**Files:**
- Create: `src-tauri/src/keyboard.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/keyboard.rs`:

```rust
#[test]
fn tracked_output_releases_all_held_keys() {
    let fake = FakeKeyboardSink::default();
    let mut output = TrackedKeyboardOutput::new(fake);
    output.key_down("A").unwrap();
    output.key_down("S").unwrap();
    output.release_all().unwrap();
    assert_eq!(output.sink().events(), vec!["down:A", "down:S", "up:A", "up:S"]);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tracked_output -- --nocapture
```

Expected: FAIL because keyboard output types do not exist yet.

- [ ] **Step 3: Implement keyboard output**

Implement a `KeyboardSink` trait, `TrackedKeyboardOutput<S>`, a fake test sink, and a Windows `SendInput` sink. Keep Windows output behind `#[cfg(windows)]`. Reject empty or unknown key names before output.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml tracked_output -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit keyboard safety layer**

Run:

```powershell
git add src-tauri/src/keyboard.rs src-tauri/src/lib.rs
git commit -m "feat: add safe keyboard output layer"
```

---

### Task 6: Add Tauri Commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/commands.rs` for command helper functions:

```rust
#[test]
fn app_snapshot_contains_default_preset_and_no_active_output() {
    let snapshot = initial_snapshot();
    assert_eq!(snapshot.presets.len(), 1);
    assert_eq!(snapshot.presets[0].id, "genshin-21-key");
    assert!(!snapshot.output_enabled);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml app_snapshot -- --nocapture
```

Expected: FAIL because commands and snapshot do not exist.

- [ ] **Step 3: Implement command helpers and Tauri handlers**

Expose commands:

- `get_app_snapshot()`
- `list_midi_inputs()`
- `parse_midi_file(path: String)`
- `set_output_enabled(enabled: bool)`
- `panic_release_all_keys()`

Register them with `tauri::generate_handler!`.

- [ ] **Step 4: Run tests and cargo check**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml app_snapshot -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS and cargo check succeeds.

- [ ] **Step 5: Commit Tauri commands**

Run:

```powershell
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: expose app backend commands"
```

---

### Task 7: Build Frontend Preset UI

**Files:**
- Create: `src/lib/presets.ts`
- Create: `src/lib/presets.test.ts`
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing Vitest tests**

Add tests in `src/lib/presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizePreset } from "./presets";

describe("summarizePreset", () => {
  it("counts enabled rules and trigger modes", () => {
    const summary = summarizePreset({
      id: "p",
      name: "Preset",
      description: "",
      schemaVersion: 1,
      playback: { speed: 1, transpose: 0, octaveFold: { enabled: false, minNote: 48, maxNote: 83 }, globalDelayMs: 0 },
      rules: [
        { id: "a", enabled: true, name: "A", inputSource: "all", eventType: "noteOn", track: null, channel: null, note: { kind: "single", value: 60 }, velocity: { min: 1, max: 127 }, output: { keys: ["A"] }, triggerMode: "tap", pressDurationMs: 35, retriggerGapMs: 12, delayMs: 0 },
        { id: "b", enabled: false, name: "B", inputSource: "all", eventType: "noteOn", track: null, channel: null, note: { kind: "single", value: 61 }, velocity: { min: 1, max: 127 }, output: { keys: ["S"] }, triggerMode: "hold", pressDurationMs: 35, retriggerGapMs: 12, delayMs: 0 }
      ]
    });
    expect(summary.enabledRules).toBe(1);
    expect(summary.triggerModes).toEqual(["tap", "hold"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- src/lib/presets.test.ts
```

Expected: FAIL because `summarizePreset` does not exist yet.

- [ ] **Step 3: Implement UI and helper**

Implement type mirrors, preset summaries, rule table rendering, input controls, MIDI input selector, output safety toggle, and the Tap/Retrigger hint near event controls. Use lucide icons for controls.

- [ ] **Step 4: Run tests and build**

Run:

```powershell
npm test -- src/lib/presets.test.ts
npm run build
```

Expected: PASS and frontend build succeeds.

- [ ] **Step 5: Commit frontend UI**

Run:

```powershell
git add src package.json package-lock.json
git commit -m "feat: build preset rule table UI"
```

---

### Task 8: Final Verification And Run Instructions

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-06-25-slimekeys-implementation.md`

- [ ] **Step 1: Add README**

Document:

- `npm install`
- `npm run tauri:dev`
- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- Current safety note that SlimeKeys sends keys to the foreground window when output is enabled.

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 3: Start local dev server**

Run:

```powershell
Start-Process -WindowStyle Hidden powershell -ArgumentList "-NoProfile", "-Command", "cd E:\SlimeKeys; npm run dev -- --host 127.0.0.1 --port 1420"
```

Expected: Vite serves the frontend at `http://127.0.0.1:1420`.

- [ ] **Step 4: Commit README and verification updates**

Run:

```powershell
git add README.md docs/superpowers/plans/2026-06-25-slimekeys-implementation.md
git commit -m "docs: add setup and verification notes"
```

- [ ] **Step 5: Push implementation branch**

Run:

```powershell
git push -u origin feature/initial-tauri-app
```

Expected: branch pushes successfully.

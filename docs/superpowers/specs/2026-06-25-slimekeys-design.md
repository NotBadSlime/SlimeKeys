# SlimeKeys Design

## Summary

SlimeKeys is a Windows desktop app for translating MIDI notes into keyboard actions. It supports both `.mid`/`.midi` file playback and real-time MIDI input devices, then routes the resulting MIDI events through configurable rule presets. The first version will use a Genshin Impact 21-key preset as the built-in default, while keeping the rule system general enough for other games, instruments, and MIDI workflows.

## Goals

- Run as a Windows desktop app during development with a command such as `npm run tauri dev`.
- Use Tauri, React, TypeScript, and Rust so the UI stays modern while MIDI and keyboard output remain native.
- Load MIDI files, play/pause/stop them, and translate notes into keyboard actions during playback.
- Listen to real-time MIDI input devices and translate incoming notes into keyboard actions with the same rule engine.
- Provide highly customizable presets with editable MIDI-to-keyboard rules.
- Include a built-in Genshin Impact 21-key preset using `Z X C V B N M`, `A S D F G H J`, and `Q W E R T Y U`.
- Support trigger behavior that handles repeated notes and finger-roll MIDI passages without turning them into accidental long presses.
- Save, duplicate, import, and export presets as JSON.
- Prepare the app structure for later packaging with Inno Setup.

## Non-Goals For The First Version

- Background-window-specific key injection. SlimeKeys sends real keyboard input to the current foreground window.
- Full piano-roll MIDI editing. The app may show status and recent events, but it is not a MIDI editor.
- Scripting-language support for arbitrary user code in rules.
- Cloud sync or online preset sharing.

## Tech Stack

- UI: React and TypeScript.
- Desktop shell: Tauri.
- Native backend: Rust.
- MIDI file parsing and scheduling: Rust-side MIDI module.
- Real-time MIDI device input: Rust-side MIDI input module.
- Keyboard output: Rust wrapper over Windows keyboard input APIs.
- Configuration storage: JSON files in the app data directory, with import/export from user-selected files.
- Installer direction: Tauri build output packaged by Inno Setup after the core app is stable.

## Architecture

The frontend owns interaction and presentation. The Rust backend owns system integration and timing-sensitive work.

```text
React UI
  -> Tauri commands/events
Rust backend
  -> MIDI file player
  -> MIDI input device listener
  -> unified MIDI event stream
  -> rule engine
  -> keyboard action scheduler
  -> Windows keyboard output
```

Both MIDI file playback and real-time MIDI input produce the same internal event type. That keeps the rule engine independent from the input source and allows every preset to work with both files and live devices.

## Main Window

The app has four primary areas.

### Presets

The left panel lists presets. Users can select, create, duplicate, rename, delete, import, and export presets.

The default preset is `Genshin 21-Key`. It maps natural notes from C3 through B5 across three keyboard rows:

- Low row: `C3 D3 E3 F3 G3 A3 B3 -> Z X C V B N M`
- Middle row: `C4 D4 E4 F4 G4 A4 B4 -> A S D F G H J`
- High row: `C5 D5 E5 F5 G5 A5 B5 -> Q W E R T Y U`

### Input And Playback Controls

The top section provides:

- MIDI file selection for `.mid` and `.midi`.
- Play, pause, stop, and current playback position.
- Playback speed.
- Transpose.
- Octave folding.
- Global output delay.
- Real-time MIDI device selection.
- Live input enable/disable.

### Rule Table

The center section is a rule table inspired by MIDI translator tools. Each rule has:

- Enabled state.
- Name.
- Input source filter: all, MIDI file, or live MIDI input.
- Event type: Note On, Note Off, or both.
- Track filter for MIDI files.
- Channel filter.
- Note filter: single note, note list, or note range.
- Velocity range.
- Output keys: single key or key combination.
- Trigger mode: Tap, Hold, Retrigger, or Chop.
- Press duration.
- Retrigger release gap.
- Per-rule delay.
- Priority/order.

Rules are evaluated from top to bottom. Multiple matching rules may trigger for the same MIDI event. This allows simple one-note mappings and more advanced layered behavior.

### Status And Logs

The bottom section shows:

- Whether SlimeKeys is currently outputting keys.
- Current MIDI file state.
- Current live MIDI input state.
- Recently matched rules.
- Skipped notes and why they were skipped.
- Device disconnects.
- Invalid preset or rule warnings.
- Safety messages when keys are forcibly released.

## Trigger Modes

Game instruments often expect short key taps, not true musical note durations. SlimeKeys therefore separates MIDI event matching from keyboard trigger behavior.

### Tap

Tap mode is the default for game instrument presets.

On `Note On`, SlimeKeys sends:

```text
key down -> wait press duration -> key up
```

The matching `Note Off` is ignored for output. This prevents long MIDI notes from becoming long keyboard holds.

### Hold

Hold mode behaves like traditional MIDI translation:

```text
Note On  -> key down
Note Off -> key up
```

This is useful when a target application genuinely needs sustained key holds.

### Retrigger

Retrigger mode handles repeated notes and finger-roll passages where the same key is already down when another matching `Note On` arrives.

If the key is already held, SlimeKeys sends:

```text
key up -> wait release gap -> key down
```

The release gap defaults to a short value such as 12 ms and is editable per rule. This helps repeated notes register as separate presses in games.

### Chop

Chop mode is an advanced option for converting a long note into repeated taps.

For a long matching note, SlimeKeys repeatedly sends taps at a configured interval until the note ends or playback stops. This is useful for MIDI files that encode tremolo or repeated-note effects as sustained notes.

### UI Hint

The event type and trigger mode controls should include a concise hint:

```text
If repeated notes sound like one long press, use Tap or Retrigger. Start with an 8-20 ms release gap.
```

## Preset Data Model

Presets are stored as JSON. The model is intentionally explicit so presets can be edited, imported, exported, and diffed.

```json
{
  "schemaVersion": 1,
  "id": "genshin-21-key",
  "name": "Genshin 21-Key",
  "description": "Default 21-key game instrument mapping.",
  "playback": {
    "speed": 1.0,
    "transpose": 0,
    "octaveFold": {
      "enabled": false,
      "minNote": 48,
      "maxNote": 83
    },
    "globalDelayMs": 0
  },
  "rules": [
    {
      "id": "c3-to-z",
      "enabled": true,
      "name": "C3 -> Z",
      "inputSource": "all",
      "eventType": "noteOn",
      "track": null,
      "channel": null,
      "note": {
        "kind": "single",
        "value": 48
      },
      "velocity": {
        "min": 1,
        "max": 127
      },
      "output": {
        "kind": "keyTap",
        "keys": ["Z"]
      },
      "triggerMode": "tap",
      "pressDurationMs": 35,
      "retriggerGapMs": 12,
      "delayMs": 0
    }
  ]
}
```

## MIDI File Playback

The MIDI file player loads a file, parses tracks and tempo events, and schedules note events according to the song timeline. Playback controls can start, pause, resume, seek, and stop.

When playback stops, pauses, or the app closes, the backend releases all keys it believes are currently down.

## Real-Time MIDI Input

The live input module lists available MIDI input devices and can open one selected device at a time for the first version. Incoming MIDI messages are normalized into the same event structure used by file playback.

If a device disconnects while listening, SlimeKeys stops live input, logs the disconnect, and releases any keys that may be held by Hold or Retrigger behavior.

## Keyboard Output Safety

Keyboard output is centralized behind one backend interface. It tracks keys currently held by SlimeKeys so the app can recover cleanly from stops, errors, and window close events.

Safety behavior includes:

- Stop releases all held keys.
- Switching presets releases all held keys.
- Disabling live input releases all held keys.
- Closing the app releases all held keys.
- Invalid key names are rejected before output.
- Output can be globally disabled for preview/testing.

## Error Handling

The app should show clear errors for:

- Unsupported or unreadable MIDI files.
- MIDI parse failures.
- Missing live MIDI devices.
- Live MIDI device disconnects.
- Invalid preset JSON.
- Invalid key names.
- Conflicting or incomplete rule settings.
- Keyboard output failure.

Errors should appear in the status/log area without crashing the app. Fatal backend errors should still force-release held keys before returning control to the UI.

## Testing Strategy

Core behavior should be tested without sending real keyboard input.

Tests should cover:

- Note name and MIDI number conversion.
- Rule matching by source, event type, track, channel, note, and velocity.
- Multiple matching rules firing in rule order.
- Tap mode generating key down and key up with the configured duration.
- Hold mode pairing Note On and Note Off.
- Retrigger mode inserting a key up and release gap before a repeated key down.
- Chop mode splitting long notes into repeated taps.
- Preset JSON import/export validation.
- Playback stop releasing tracked held keys.
- Live MIDI disconnect releasing tracked held keys.

The keyboard output layer should be replaceable with a fake implementation in tests.

## Packaging Direction

Development runs through the Tauri dev command. Release builds use Tauri's Windows build output. After that, an Inno Setup script can package the executable and supporting files into a normal installer.

The repository should keep packaging scripts separate from application logic so installer work can happen after the app is usable.

## Approved Decisions

- Use Tauri, React, TypeScript, and Rust.
- Build a Windows desktop app, not a browser-only web app.
- Development starts by command-line launch, with installer packaging later.
- Support both MIDI file playback and real-time MIDI input devices in the first version.
- Send real keyboard input to the current foreground window.
- Use the Genshin Impact 21-key layout as the built-in default preset.
- Make presets highly customizable with a Bome-like rule table.
- Default game-style mappings to Tap mode instead of Hold mode.
- Include Retrigger behavior for repeated notes and finger-roll MIDI passages.


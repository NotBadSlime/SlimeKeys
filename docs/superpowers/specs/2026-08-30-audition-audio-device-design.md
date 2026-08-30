# Audition Playback Device Design

## Goal

Let the Sound toggle play mapped notes through a user-chosen Windows playback device (speakers, headphones, virtual cables), instead of always following the system default via the first MIDI port.

## Scope

This feature adds:

- In-process SoundFont synthesis for file/queue audition.
- WASAPI output to a selected render device, or to the system default device.
- A device dropdown next to both Sound toggles (toolbar and rules inspector).
- Global persistence of the chosen device.
- Fallback to the system default when the saved device is missing, without rewriting the saved id.

This feature does not add:

- Per-preset device selection.
- A MIDI output-port picker for audition.
- Changing the Windows system default device.
- Audition for live MIDI input (live input stays keyboard-only).
- Simultaneous output to more than one device.

## Current Behavior

Sound audition maps notes through the existing rule filter, then `dispatch_midi_events` opens the first `midir` output port (typically Microsoft GS Wavetable Synth). That synthesizer is outside the SlimeKeys process, so its audio always follows the Windows default playback device. The UI already lists MIDI outputs for diagnostics but never lets the user choose one.

## User Experience

Place a `<select>` immediately to the right of the toolbar Sound switch. Mirror the same control beside the Sound switch in the rules inspector.

Options:

1. System default (always first).
2. Each currently active WASAPI render device, labeled with the system-provided name.

Behavior:

- Opening the dropdown or clicking refresh re-enumerates active devices. Unplugged devices disappear.
- Choosing a device takes effect immediately: close the current stream, all-notes-off, open the new device. Notes that were sounding cut over rather than migrate.
- Turning Sound off mutes and releases sounding notes; it does not change the stored device.
- If the saved device id is not in the current list, the dropdown shows System default and playback uses the default device. The saved id is left unchanged so the original device is reselected when it reappears.
- If there are no playback devices, the dropdown is disabled and the UI shows that no playback device was found.

Update copy so Sound is described as playing mapped notes through the selected system playback device, not through MIDI Out. Add matching English and Chinese strings.

## Architecture

Keep rule mapping, keyboard output, and `PlaybackClock` unchanged. Replace only the last mile of audition.

```text
mapped MIDI events
        │
        ▼
  existing audition scheduler
  (clock, audition delay, track filter, Sound toggle)
        │
        ▼
  SoundFont synthesizer (in-process)
        │ PCM
        ▼
  WASAPI stream ──► selected device
                       │ if missing / open fails
                       ▼
                    system default
```

Device identity is the Windows `IMMDevice` id string, not a list index. `null` / follow-default means `GetDefaultAudioEndpoint` for render with the multimedia role. The WASAPI stream uses shared mode at the device mix format; the synth renders to that format.

MIDI output listing may remain as a diagnostic command. Audition no longer connects to a MIDI port, and playback no longer treats “no MIDI output” as a blocker.

## Components

### Audio devices (`audio_output`)

Windows-only module using the existing `windows` crate (`Win32_Media_Audio` and COM). Responsibilities:

- Enumerate active render endpoints.
- Resolve the current system default endpoint.
- Open and close a WASAPI shared-mode output stream for a device id.
- Write PCM from the synthesizer callback/thread.

### Audition engine (`audition_engine`)

- Load a compact, redistributable GM SoundFont shipped as a Tauri resource (`src-tauri/resources/audition.sf2` or `.sf3`), targeting a binary increase of about 8MB or less.
- Use a pure-Rust SoundFont synth (`rustysynth`) so audition does not depend on Microsoft GS Wavetable.
- Consume the same mapped `MidiEvent` stream the current dispatcher uses (note on/off, velocity, channel, control change).
- Honor Sound on/off, track mute, cancel, and all-notes-off.

### App state

`AppState` holds:

- `audition_enabled` (unchanged).
- Selected device id: `Option<String>` where `None` means follow system default.
- Shared engine handle so playback and device changes use the same stream.

### Frontend

- Persist `{ followSystemDefault: boolean, deviceId: string | null }` under `slimekeys.audioOutput.v1`, same global style as `slimekeys.auditionOutput.v1`. Not part of a preset.
- On startup, call `list_audio_outputs` and match the saved id. Display System default when unmatched; do not rewrite storage.
- On user change, call `set_audio_output_device` and write storage.
- Gate audition playback on audio devices, not `midiOutputs.length`.

## Data Flow

Startup:

1. Load stored `{ followSystemDefault, deviceId }`.
2. List audio outputs.
3. Effective device = system default if `followSystemDefault`, or if `deviceId` is missing from the list; otherwise `deviceId`.
4. `set_audio_output_device` with that effective choice (still keeping the original stored id when falling back).

User selects a named device:

1. Save `{ followSystemDefault: false, deviceId }`.
2. Backend switches the WASAPI stream to that id.

User selects System default:

1. Save `{ followSystemDefault: true, deviceId: null }`.
2. Backend always opens the current default endpoint.

Play:

1. `start_playback` still builds the mapped MIDI event plan.
2. Replace `dispatch_midi_events` with the audition engine writing to the current stream.
3. If the output mode needs sound and no device can be opened, fail with a readable error.
4. If the output mode is keys-only, audition failure is ignored, matching today’s MIDI-port behavior.

Device change during playback: all-notes-off, close stream, open the new device, continue scheduling remaining events. Sounding notes do not continue on the new device.

Live MIDI input does not enter this engine.

## Error Handling

- Enumeration failure or empty list: disable the dropdown, show that no playback device was found. Sound-only play cannot start. Keyboard-only play still can.
- Saved id missing: silent fallback to system default in both UI and playback. Do not change storage. Log only if play actually opens the fallback.
- Open selected device fails (exclusive mode, permission): fall back to default for this session. If default also fails, mute audition, log the reason, leave keyboard output running.
- Device disappears mid-play: all-notes-off, switch to default. If that fails, mute audition and keep keyboard playback.
- SoundFont missing or invalid: audition unavailable, surface a clear error, do not hang play setup.
- Stream close during device switch: all-notes-off first so the old device does not keep a tail.

## Testing

Frontend:

- Storage round-trip for follow-default and a concrete device id.
- Missing saved id displays System default without rewriting storage.
- Reappearing id is selected again on the next list refresh.
- i18n keys exist for English and Chinese.

Rust:

- Effective-device resolution: listed id is used; unknown id falls back to default; follow-default always uses default.
- Synth: note on produces non-silent PCM; note off / all-notes-off decays toward silence; channel and velocity affect the message path.
- Scheduler: audition delay, clock, Sound-off, and track filter keep current command tests valid with the engine as the sink instead of a MIDI port.

Manual:

- Dropdown lists real playback devices.
- Sound plays from the selected device, not an unselected one.
- Unplug selected device: falls back to default; plug it back in: selection returns.
- Switch devices while a song is playing.
- Sound off still silences audition without changing the dropdown.

## Commands and Types

```text
list_audio_outputs() -> AudioOutputDevice[]
set_audio_output_device(deviceId: string | null) -> AudioOutputDevice | null
```

`AudioOutputDevice`: `{ id: string, name: string, isDefault: boolean }`.

`set_audio_output_device(null)` follows the system default. The command returns the device actually opened (the default when falling back), or `null` if nothing could be opened.

Keep `list_midi_outputs` if useful for diagnostics; stop using it to decide whether Sound play is allowed.

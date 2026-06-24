# SlimeKeys Global Hotkeys Design

## Goal

Add configurable global hotkeys so playback can be controlled while another app, such as a game, is in the foreground. The first version covers play, stop, next song, previous song, and emergency release-all.

## Scope

The feature adds:

- Global hotkey registration for playback commands.
- A visible hotkey configuration panel in the desktop UI.
- MIDI playlist support when the user imports more than one file.
- Folder fallback navigation when only one MIDI file is opened.
- Local persistence for hotkey settings.
- Clear logs when a shortcut cannot be registered or a playback command cannot run.

Pause/resume can be represented in the data model later, but it is not part of this first implementation because current playback is dispatched as timed keyboard actions on a worker thread and has no pause state.

## User Experience

The right-side output area will gain a compact Hotkeys section. Each row shows the action name, the current shortcut, a record button, and a clear button. Recording listens for the next key combination and updates that action.

Default shortcuts:

- Play current song: `Ctrl+Alt+P`
- Stop playback: `Ctrl+Alt+S`
- Next song: `Ctrl+Alt+Right`
- Previous song: `Ctrl+Alt+Left`
- Release all keys: `Ctrl+Alt+Backspace`

If registration fails because another app owns a shortcut, SlimeKeys keeps the previous valid setting and writes a recent-event log entry.

## Playback Model

SlimeKeys will track a song queue in the frontend:

- Opening multiple MIDI files creates a playlist in the selected order.
- Opening one MIDI file sets that file as the current song.
- Next and previous first use the playlist if it contains more than one song.
- If there is no playlist, next and previous scan the current file's folder for `.mid` and `.midi` files, sorted by filename.
- Next wraps from the last song to the first.
- Previous wraps from the first song to the last.
- Switching songs stops current playback, releases held keys, loads the target MIDI file, and starts playback.

## Architecture

Use the Tauri global shortcut plugin rather than a handwritten Windows `RegisterHotKey` bridge. This keeps the feature aligned with Tauri's desktop model and makes shortcut registration easier to manage from the UI layer.

Frontend responsibilities:

- Store playlist state and current song state.
- Render hotkey configuration.
- Persist and restore hotkey bindings.
- Register and unregister global shortcuts.
- Convert shortcut activations into existing Tauri commands such as `play_midi_file`, `stop_playback`, and `panic_release_all_keys`.
- Add a small Tauri command for listing MIDI files in a folder for folder fallback navigation.

Backend responsibilities:

- Continue owning keyboard output, playback dispatch, and release-all safety.
- Provide a folder MIDI listing command that returns sorted `.mid` and `.midi` paths.
- Keep playback stop behavior as the single path that cancels queued actions and releases held keys.

## Data

Add frontend types:

- `HotkeyAction`: `play`, `stop`, `next`, `previous`, `releaseAll`
- `HotkeyBinding`: action id, label key, accelerator string, enabled flag
- `SongEntry`: path and display name

Persist hotkeys in local app storage. If the saved data is missing or invalid, SlimeKeys falls back to defaults.

## Error Handling

- Invalid or duplicate shortcut: reject the edit and log the reason.
- Shortcut registration failure: keep the previous binding and log the failure.
- Next or previous with no current song: log that no MIDI file is selected.
- Folder fallback with no other MIDI files: keep the current song and log that no MIDI files were found.
- Playback errors during hotkey actions: log the same readable errors used by toolbar actions.

## Testing

Frontend tests:

- Default hotkey bindings contain the five required actions.
- Duplicate shortcuts are rejected.
- Playlist next/previous wraps at the ends.
- Folder fallback chooses the next/previous path from a sorted list.

Rust tests:

- Folder MIDI listing includes `.mid` and `.midi`.
- Folder MIDI listing excludes non-MIDI files.
- Folder MIDI listing is sorted predictably.

Manual verification:

- Register default hotkeys in the desktop app.
- Confirm shortcuts fire while SlimeKeys is not focused.
- Confirm next/previous stops current playback and starts the wrapped target.
- Confirm release-all works even when no song is playing.

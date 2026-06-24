# SlimeKeys

SlimeKeys is a Windows desktop app for translating MIDI notes into keyboard actions. It is built with Tauri, React, TypeScript, and Rust.

## Current Features

- Built-in Genshin 21-key preset.
- Rule-table UI for MIDI note to keyboard mappings.
- Trigger modes for Tap, Hold, Retrigger, and Chop.
- MIDI file parsing and scheduled playback through the backend.
- Real-time MIDI input device listing and live input command support.
- Safe keyboard output wrapper that tracks and releases keys held by SlimeKeys.

## Safety Note

When keyboard output is enabled, SlimeKeys sends real key events to the current foreground window. Keep output disabled while configuring presets, and only enable it when the target game or app is focused.

## Development

Install dependencies:

```powershell
npm install
```

Run the Tauri desktop app:

```powershell
npm run tauri:dev
```

Run the frontend preview only:

```powershell
npm run dev
```

## Verification

Run frontend tests:

```powershell
npm test
```

Run Rust tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Build frontend assets:

```powershell
npm run build
```

Check the Rust backend:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

## Packaging Direction

Use Tauri's Windows build output first:

```powershell
npm run tauri:build
```

After the app is stable, the generated Windows application files can be wrapped with an Inno Setup installer script.

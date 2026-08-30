# Global Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable global hotkeys for play, stop, next song, previous song, and release-all while supporting playlist and folder fallback navigation.

**Architecture:** Keep playback control state in the React layer, use the Tauri global shortcut plugin for OS-level shortcuts, and add one Rust command for sorted MIDI file discovery in the current folder. Pure TypeScript helpers own hotkey defaults, validation, persistence shaping, and queue navigation so they can be covered with fast unit tests.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2, `@tauri-apps/plugin-global-shortcut`, `tauri-plugin-global-shortcut`, Rust unit tests.

---

### Task 1: Hotkey Model And Validation

**Files:**
- Create: `src/lib/hotkeys.ts`
- Test: `src/lib/hotkeys.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing TypeScript tests**

Create `src/lib/hotkeys.test.ts` with tests for default actions, duplicate rejection, and saved-setting normalization.

Run: `npm test -- src/lib/hotkeys.test.ts`

Expected: fail because `src/lib/hotkeys.ts` does not exist.

- [ ] **Step 2: Implement hotkey helpers**

Create `src/lib/hotkeys.ts` exporting:

- `HOTKEY_ACTIONS`
- `DEFAULT_HOTKEYS`
- `normalizeAccelerator`
- `validateHotkeyBindings`
- `mergeSavedHotkeys`

Add TypeScript types in `src/types.ts`:

- `HotkeyAction`
- `HotkeyBinding`

- [ ] **Step 3: Verify helper tests pass**

Run: `npm test -- src/lib/hotkeys.test.ts`

Expected: all hotkey helper tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/hotkeys.ts src/lib/hotkeys.test.ts src/types.ts
git commit -m "feat: add hotkey configuration model"
```

### Task 2: Song Queue Navigation

**Files:**
- Create: `src/lib/songQueue.ts`
- Test: `src/lib/songQueue.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing TypeScript tests**

Create `src/lib/songQueue.test.ts` covering:

- playlist next wraps from last to first.
- playlist previous wraps from first to last.
- folder fallback uses a sorted folder list when no playlist exists.
- no current song returns `null`.

Run: `npm test -- src/lib/songQueue.test.ts`

Expected: fail because `src/lib/songQueue.ts` does not exist.

- [ ] **Step 2: Implement queue helpers**

Create `src/lib/songQueue.ts` exporting:

- `songEntryFromPath(path: string): SongEntry`
- `selectRelativeSong(args): SongEntry | null`
- `isMidiPath(path: string): boolean`

Add `SongEntry` to `src/types.ts`.

- [ ] **Step 3: Verify queue tests pass**

Run: `npm test -- src/lib/songQueue.test.ts`

Expected: all queue tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/lib/songQueue.ts src/lib/songQueue.test.ts src/types.ts
git commit -m "feat: add song queue navigation"
```

### Task 3: Backend Folder MIDI Listing

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/commands.rs` for a helper named `list_midi_files_in_dir` that:

- includes `.mid` and `.midi`.
- excludes other files.
- sorts by filename.

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_midi_files_in_dir -- --nocapture`

Expected: fail because the helper does not exist.

- [ ] **Step 2: Implement folder listing**

Add:

- private helper `list_midi_files_in_dir(dir: &Path) -> Result<Vec<String>, String>`
- command `list_midi_files_near(path: String) -> Result<Vec<String>, String>`
- `list_midi_files_near` in the Tauri invoke handler.

- [ ] **Step 3: Verify Rust tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml list_midi_files_in_dir -- --nocapture`

Expected: all folder listing tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: list midi files for folder navigation"
```

### Task 4: Global Shortcut Plugin Wiring

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Install plugin dependencies**

Run:

```bash
npm install @tauri-apps/plugin-global-shortcut@2.3.2
cargo add tauri-plugin-global-shortcut@2.3.2 --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Wire Rust plugin**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_global_shortcut::Builder::new().build())` to the Tauri builder before `.manage(AppState::new())`.

- [ ] **Step 3: Verify dependency wiring**

Run:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/Cargo.lock
git commit -m "feat: wire global shortcut plugin"
```

### Task 5: UI And Playback Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add UI translations**

Add Chinese and English labels for:

- Hotkeys
- Record
- Clear
- Play current song
- Stop playback
- Next song
- Previous song
- Release all keys
- No MIDI files found
- Hotkey registered
- Hotkey registration failed
- Duplicate hotkey

- [ ] **Step 2: Add playlist state and multi-file open**

Change the MIDI open dialog to `multiple: true`. Store selected paths as `SongEntry[]`, keep the selected song index, parse the selected file, and show the current file name in the status line.

- [ ] **Step 3: Add playback control helpers**

In `App.tsx`, add helper functions:

- `loadSong(song: SongEntry)`
- `playSong(song: SongEntry)`
- `stopPlayback()`
- `moveSong(direction: 1 | -1)`

Use `list_midi_files_near` when playlist length is 1.

- [ ] **Step 4: Add hotkey panel**

Render a compact hotkey panel in the inspector. Each row shows action label, accelerator, record button, and clear button.

- [ ] **Step 5: Register global shortcuts**

Use `@tauri-apps/plugin-global-shortcut` to register enabled bindings. On shortcut events, dispatch to the helper functions from Step 3. Keep a cleanup function that unregisters shortcuts when bindings change or the component unmounts.

- [ ] **Step 6: Verify frontend**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/App.tsx src/lib/i18n.ts src/styles.css
git commit -m "feat: add global hotkey controls"
```

### Task 6: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests pass.

- [ ] **Step 2: Run full builds**

Run:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Expected: all commands exit 0 and Tauri produces installer bundles.

- [ ] **Step 3: Final status**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected: branch is ahead of origin with a clean working tree.

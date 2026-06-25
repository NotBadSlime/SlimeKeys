import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import {
  Download,
  FileMusic,
  FolderOpen,
  Import,
  Keyboard,
  Languages,
  Pause,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import type {
  AppSnapshot,
  HotkeyAction,
  HotkeyBinding,
  InputSource,
  MidiEvent,
  MidiEventType,
  MidiInputDevice,
  Preset,
  Rule,
  SongEntry,
  TriggerMode,
} from "./types";
import {
  createTranslator,
  defaultLanguage,
  detectLanguage,
  type Language,
  type TranslationKey,
} from "./lib/i18n";
import {
  captureHotkeyFromKeyboardEvent,
  DEFAULT_HOTKEYS,
  mergeSavedHotkeys,
  normalizeAccelerator,
  shouldHandleShortcutEvent,
  validateHotkeyBindings,
} from "./lib/hotkeys";
import { parseStoredKeymap, stringifyKeymap } from "./lib/keymapStorage";
import {
  eventTypeLabel,
  fallbackGenshinPreset,
  summarizePreset,
  triggerModeLabel,
} from "./lib/presets";
import {
  clampPlaybackMs,
  formatPlaybackTime,
  midiDurationMs,
  playbackStartMs,
} from "./lib/playbackProgress";
import {
  createPresetFromSource,
  deletePresetById,
  fileNameForPreset,
  prepareImportedPreset,
  withJsonExtension,
} from "./lib/presetManagement";
import {
  addRuleToPreset,
  bulkUpdateRulesInPreset,
  formatRuleKeys,
  keysFromInput,
  noteInputValue,
  parseSingleNoteInput,
  removeRuleFromPreset,
  updateRuleInPreset,
} from "./lib/ruleEditing";
import { selectRelativeSong, songEntryFromPath } from "./lib/songQueue";

const HOTKEY_STORAGE_KEY = "slimekeys.hotkeys.v1";
const KEYMAP_STORAGE_KEY = "slimekeys.keymap.v1";
const EVENT_TYPES: MidiEventType[] = ["noteOn", "noteOff", "both"];
const INPUT_SOURCES: InputSource[] = ["all", "file", "live"];
const TRIGGER_MODES: TriggerMode[] = ["tap", "hold", "retrigger", "chop"];

function App() {
  const initialKeymap = useMemo(() => loadInitialKeymap(), []);
  const [language, setLanguage] = useState<Language>(() =>
    typeof navigator === "undefined"
      ? defaultLanguage
      : detectLanguage(navigator.language),
  );
  const [presets, setPresets] = useState<Preset[]>(initialKeymap.presets);
  const [selectedPresetId, setSelectedPresetId] = useState(
    initialKeymap.selectedPresetId,
  );
  const [midiInputs, setMidiInputs] = useState<MidiInputDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [outputEnabled, setOutputEnabled] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [openedPath, setOpenedPath] = useState("");
  const [openedFile, setOpenedFile] = useState<string>("");
  const [midiEvents, setMidiEvents] = useState<MidiEvent[]>([]);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playlist, setPlaylist] = useState<SongEntry[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [hotkeys, setHotkeys] = useState<HotkeyBinding[]>(() =>
    loadStoredHotkeys(),
  );
  const [recordingAction, setRecordingAction] = useState<HotkeyAction | null>(
    null,
  );
  const [bulkEventType, setBulkEventType] = useState<MidiEventType>("both");
  const [bulkInputSource, setBulkInputSource] = useState<InputSource>("all");
  const [bulkTriggerMode, setBulkTriggerMode] =
    useState<TriggerMode>("retrigger");
  const [bulkPressDurationMs, setBulkPressDurationMs] = useState(35);
  const [logs, setLogs] = useState<string[]>([]);
  const hotkeyHandlersRef = useRef<Record<HotkeyAction, () => void>>({
    play: () => undefined,
    stop: () => undefined,
    next: () => undefined,
    previous: () => undefined,
    releaseAll: () => undefined,
  });
  const progressTimerRef = useRef<number | null>(null);
  const progressStartedAtRef = useRef(0);
  const progressOffsetMsRef = useRef(0);
  const pendingSeekMsRef = useRef<number | null>(null);
  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => {
    void loadBackendState();
    const refreshTimer = window.setInterval(() => {
      if (!liveEnabled) {
        void refreshMidiInputs(true);
      }
    }, 3000);

    return () => window.clearInterval(refreshTimer);
    // This intentionally tracks language so initial logs switch after a language change.
  }, [language, liveEnabled]);

  useEffect(() => {
    setOpenedFile((current) => current || t("noMidiFile"));
    setLogs([t("ready"), t("defaultPresetTap")]);
  }, [t]);

  useEffect(() => {
    hotkeyHandlersRef.current = {
      play: () => void handlePlay(),
      stop: () => void stopPlayback(true),
      next: () => void moveSong(1),
      previous: () => void moveSong(-1),
      releaseAll: () => void handleReleaseAll(),
    };
  });

  useEffect(() => () => clearProgressTimer(), []);

  useEffect(() => {
    if (!recordingAction) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const result = captureHotkeyFromKeyboardEvent(event);
      if (result.kind === "pending") {
        return;
      }

      if (result.kind === "cancel") {
        setRecordingAction(null);
        pushLog(t("hotkeyRecordingCancelled"));
        return;
      }

      if (result.kind === "clear") {
        const nextHotkeys = hotkeys.map((binding) =>
          binding.action === recordingAction
            ? { ...binding, accelerator: "", enabled: false }
            : binding,
        );
        persistHotkeys(nextHotkeys);
        setHotkeys(nextHotkeys);
        setRecordingAction(null);
        pushLog(
          `${t("hotkeyCleared")}: ${t(hotkeyActionLabels[recordingAction])}`,
        );
        return;
      }

      if (result.kind === "invalid") {
        pushLog(t("hotkeyInvalid"));
        setRecordingAction(null);
        return;
      }

      const accelerator = result.accelerator;
      const nextHotkeys = hotkeys.map((binding) =>
        binding.action === recordingAction
          ? { ...binding, accelerator, enabled: true }
          : binding,
      );
      const validation = validateHotkeyBindings(nextHotkeys);
      if (!validation.ok) {
        pushLog(
          validation.error === "duplicate"
            ? t("hotkeyDuplicate")
            : t("hotkeyInvalid"),
        );
        setRecordingAction(null);
        return;
      }

      persistHotkeys(nextHotkeys);
      setHotkeys(nextHotkeys);
      setRecordingAction(null);
      pushLog(`${t("hotkeySaved")}: ${accelerator}`);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [hotkeys, recordingAction, t]);

  useEffect(() => {
    const validation = validateHotkeyBindings(hotkeys);
    if (!validation.ok) {
      pushLog(
        validation.error === "duplicate"
          ? t("hotkeyDuplicate")
          : t("hotkeyInvalid"),
      );
      return;
    }

    const enabledBindings = hotkeys.filter(
      (binding) => binding.enabled && binding.accelerator.trim(),
    );
    if (enabledBindings.length === 0) {
      return;
    }

    const shortcuts = enabledBindings.map((binding) => binding.accelerator);
    const actionByShortcut = new Map(
      enabledBindings.map((binding) => [
        normalizeAccelerator(binding.accelerator).toLowerCase(),
        binding.action,
      ]),
    );
    let disposed = false;

    const registration = register(shortcuts, (event) => {
      if (!shouldHandleShortcutEvent(event.state)) {
        return;
      }

      const action = actionByShortcut.get(
        normalizeAccelerator(event.shortcut).toLowerCase(),
      );
      if (action) {
        window.setTimeout(() => hotkeyHandlersRef.current[action](), 80);
      }
    })
      .then(() => {
        if (!disposed) {
          pushLog(t("hotkeyRegistered"));
        }
      })
      .catch((error) => {
        if (!disposed) {
          pushLog(`${t("hotkeyRegistrationFailed")}: ${readableError(error)}`);
        }
      });

    return () => {
      disposed = true;
      void registration
        .then(() => unregister(shortcuts))
        .catch(() => undefined);
    };
  }, [hotkeys, t]);

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const selectedMidiInput = midiInputs.find(
    (device) => String(device.id) === selectedInputId,
  );
  const currentSong =
    playlist[currentSongIndex] ??
    (openedPath ? songEntryFromPath(openedPath) : null);
  const songDurationMs = useMemo(() => midiDurationMs(midiEvents), [midiEvents]);
  const displayedPlaybackMs = pendingSeekMs ?? playbackPositionMs;
  const summary = useMemo(
    () => summarizePreset(selectedPreset),
    [selectedPreset],
  );
  const hotkeyActionLabels: Record<HotkeyAction, TranslationKey> = {
    play: "hotkeyPlay",
    stop: "hotkeyStop",
    next: "hotkeyNext",
    previous: "hotkeyPrevious",
    releaseAll: "hotkeyReleaseAll",
  };

  async function loadBackendState() {
    try {
      const snapshot = await invoke<AppSnapshot>("get_app_snapshot");
      const storedKeymap = loadStoredKeymap();
      const nextPresets = storedKeymap?.presets ?? snapshot.presets;
      setPresets(nextPresets);
      setSelectedPresetId(
        selectedPresetIdFor(
          nextPresets,
          storedKeymap?.selectedPresetId ?? snapshot.presets[0]?.id,
        ),
      );
      setOutputEnabled(snapshot.outputEnabled);
      pushLog(storedKeymap ? t("keymapLoaded") : t("backendConnected"));
    } catch {
      const storedKeymap = loadStoredKeymap();
      if (storedKeymap) {
        setPresets(storedKeymap.presets);
        setSelectedPresetId(
          selectedPresetIdFor(
            storedKeymap.presets,
            storedKeymap.selectedPresetId,
          ),
        );
        pushLog(t("keymapLoaded"));
      } else {
        pushLog(t("previewMode"));
      }
    }

    await refreshMidiInputs(true);
  }

  async function refreshMidiInputs(silent = false) {
    try {
      const devices = await invoke<MidiInputDevice[]>("list_midi_inputs");
      setMidiInputs(devices);
      if (devices[0]) {
        setSelectedInputId((current) => current || String(devices[0].id));
      }
      if (!silent) {
        pushLog(
          devices.length > 0
            ? `${t("midiDevicesFound")}: ${devices.map((device) => device.name).join(", ")}`
            : t("midiDevicesNotFound"),
        );
      }
    } catch {
      setMidiInputs([]);
      if (!silent) {
        pushLog(t("midiDevicesRefreshFailed"));
      }
    }
  }

  async function handleOpenMidi() {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "MIDI", extensions: ["mid", "midi"] }],
      });
      const paths =
        typeof selected === "string"
          ? [selected]
          : Array.isArray(selected)
            ? selected
            : [];
      if (paths.length === 0) {
        return;
      }

      const songs = paths.map(songEntryFromPath);
      setPlaylist(songs);
      setCurrentSongIndex(0);
      await loadSong(songs[0], true);
    } catch (error) {
      pushLog(`${t("openMidiFailed")}: ${readableError(error)}`);
    }
  }

  async function handlePlay() {
    const startAtMs = playbackStartMs(playbackPositionMs, songDurationMs);
    await playSong(currentSong, startAtMs);
  }

  async function handlePause() {
    await pausePlayback(true);
  }

  async function playSong(song: SongEntry | null, startAtMs = 0) {
    if (!song) {
      pushLog(t("openBeforePlayback"));
      return;
    }

    try {
      let events = midiEvents;
      if (song.path !== openedPath) {
        events = await loadSong(song, false);
      }
      await startPlayback(song, startAtMs, midiDurationMs(events));
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  async function startPlayback(
    song: SongEntry,
    startAtMs = 0,
    durationMs = songDurationMs,
  ) {
    const seekMs = clampPlaybackMs(startAtMs, durationMs);
    const actionCount = await invoke<number>("play_midi_file_from", {
      path: song.path,
      startAtMs: seekMs,
      preset: selectedPreset,
    });
    beginProgress(seekMs, durationMs);
    if (!outputEnabled) {
      pushLog(t("outputDisabledPlaybackWarning"));
    }
    pushLog(`${t("playbackStarted")}: ${actionCount}`);
  }

  async function handleStop() {
    await stopPlayback(true);
  }

  async function stopPlayback(log: boolean) {
    try {
      await invoke("stop_playback");
      stopProgress(true);
      if (log) {
        pushLog(t("playbackStopped"));
      }
    } catch (error) {
      pushLog(`${t("stopFailed")}: ${readableError(error)}`);
    }
  }

  async function pausePlayback(log: boolean) {
    if (!playbackActive) {
      return;
    }

    const pausedAtMs = currentPlaybackPositionMs(songDurationMs);
    try {
      await invoke("stop_playback");
      stopProgress(false);
      setPlaybackPositionMs(pausedAtMs);
      if (log) {
        pushLog(t("playbackPaused"));
      }
    } catch (error) {
      pushLog(`${t("stopFailed")}: ${readableError(error)}`);
    }
  }

  async function loadSong(song: SongEntry, logParsed: boolean): Promise<MidiEvent[]> {
    setOpenedPath(song.path);
    setOpenedFile(song.name);
    clearProgressTimer();
    setPlaybackActive(false);
    setPlaybackPositionMs(0);
    pendingSeekMsRef.current = null;
    setPendingSeekMs(null);
    const events = await invoke<MidiEvent[]>("parse_midi_file", {
      path: song.path,
    });
    setMidiEvents(events);
    if (logParsed) {
      pushLog(`${t("parsedMidiEvents")}: ${events.length} (${song.name})`);
    }
    return events;
  }

  async function moveSong(direction: 1 | -1) {
    if (!openedPath) {
      pushLog(t("openBeforePlayback"));
      return;
    }

    try {
      const folderSongs =
        playlist.length > 1
          ? []
          : (
              await invoke<string[]>("list_midi_files_near", {
                path: openedPath,
              })
            ).map(songEntryFromPath);
      if (playlist.length <= 1 && folderSongs.length <= 1) {
        pushLog(t("noMidiFilesFound"));
        return;
      }
      const selectedSong = selectRelativeSong({
        currentPath: openedPath,
        direction,
        playlist,
        folderSongs,
      });

      if (!selectedSong) {
        pushLog(t("noMidiFilesFound"));
        return;
      }

      await stopPlayback(false);
      if (playlist.length > 1) {
        setCurrentSongIndex(
          Math.max(
            0,
            playlist.findIndex((song) => song.path === selectedSong.path),
          ),
        );
      } else {
        setPlaylist([selectedSong]);
        setCurrentSongIndex(0);
      }
      const events = await loadSong(selectedSong, false);
      await startPlayback(selectedSong, 0, midiDurationMs(events));
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  function handleSeekInput(value: string) {
    const seekMs = clampPlaybackMs(Number(value), songDurationMs);
    pendingSeekMsRef.current = seekMs;
    setPendingSeekMs(seekMs);
  }

  async function commitSeek() {
    const pendingSeek = pendingSeekMsRef.current ?? pendingSeekMs;
    if (pendingSeek === null) {
      return;
    }

    const seekMs = clampPlaybackMs(pendingSeek, songDurationMs);
    pendingSeekMsRef.current = null;
    setPendingSeekMs(null);
    setPlaybackPositionMs(seekMs);
    if (!playbackActive || !currentSong) {
      return;
    }

    try {
      await startPlayback(currentSong, seekMs);
    } catch (error) {
      stopProgress(false);
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  function beginProgress(startAtMs: number, durationMs: number) {
    clearProgressTimer();
    const clampedStart = clampPlaybackMs(startAtMs, durationMs);
    progressStartedAtRef.current = performance.now();
    progressOffsetMsRef.current = clampedStart;
    setPlaybackPositionMs(clampedStart);

    if (durationMs <= 0 || clampedStart >= durationMs) {
      setPlaybackActive(false);
      return;
    }

    setPlaybackActive(true);
    progressTimerRef.current = window.setInterval(() => {
      const elapsedMs = performance.now() - progressStartedAtRef.current;
      const nextPosition = clampPlaybackMs(
        progressOffsetMsRef.current + elapsedMs,
        durationMs,
      );
      setPlaybackPositionMs(nextPosition);
      if (nextPosition >= durationMs) {
        clearProgressTimer();
        setPlaybackActive(false);
      }
    }, 100);
  }

  function currentPlaybackPositionMs(durationMs: number) {
    if (!playbackActive) {
      return clampPlaybackMs(playbackPositionMs, durationMs);
    }

    const elapsedMs = performance.now() - progressStartedAtRef.current;
    return clampPlaybackMs(progressOffsetMsRef.current + elapsedMs, durationMs);
  }

  function stopProgress(resetPosition: boolean) {
    clearProgressTimer();
    setPlaybackActive(false);
    pendingSeekMsRef.current = null;
    setPendingSeekMs(null);
    if (resetPosition) {
      setPlaybackPositionMs(0);
    }
  }

  function clearProgressTimer() {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  async function handleLiveToggle(next: boolean) {
    const selectedDevice = midiInputs.find(
      (device) => String(device.id) === selectedInputId,
    );

    if (next && selectedInputId === "") {
      pushLog(t("selectMidiBeforeLive"));
      return;
    }
    if (next && selectedDevice && !selectedDevice.availableForLive) {
      pushLog(selectedDevice.note ?? t("midiServicesDetected"));
      return;
    }

    setLiveEnabled(next);
    try {
      if (next) {
        await invoke("start_live_input", {
          deviceId: Number(selectedInputId),
          preset: selectedPreset,
        });
        pushLog(t("liveInputEnabled"));
      } else {
        await invoke("stop_live_input");
        pushLog(t("liveInputDisabled"));
      }
    } catch (error) {
      setLiveEnabled(false);
      pushLog(`${t("liveFailed")}: ${readableError(error)}`);
    }
  }

  async function handleOutputToggle(next: boolean) {
    setOutputEnabled(next);
    try {
      const enabled = await invoke<boolean>("set_output_enabled", {
        enabled: next,
      });
      setOutputEnabled(enabled);
      pushLog(enabled ? t("outputEnabledLog") : t("outputDisabledLog"));
    } catch (error) {
      setOutputEnabled(false);
      pushLog(`${t("outputToggleFailed")}: ${readableError(error)}`);
    }
  }

  async function handleReleaseAll() {
    try {
      await invoke("panic_release_all_keys");
      pushLog(t("releasedKeys"));
    } catch (error) {
      pushLog(`${t("releaseFailed")}: ${readableError(error)}`);
    }
  }

  function handleCreatePreset() {
    const preset = createPresetFromSource(selectedPreset, presets);
    setPresets((current) => [...current, preset]);
    setSelectedPresetId(preset.id);
    pushLog(`${t("presetCreated")}: ${preset.name}`);
  }

  async function handleImportPreset() {
    try {
      const selected = await open({
        filters: [{ name: "SlimeKeys Preset", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }

      const imported = await invoke<Preset>("import_preset_file", {
        path: selected,
      });
      const preset = prepareImportedPreset(imported, presets);
      setPresets((current) => [...current, preset]);
      setSelectedPresetId(preset.id);
      pushLog(`${t("presetImported")}: ${preset.name}`);
    } catch (error) {
      pushLog(`${t("presetImportFailed")}: ${readableError(error)}`);
    }
  }

  async function handleExportPreset() {
    try {
      const selected = await save({
        defaultPath: fileNameForPreset(selectedPreset),
        filters: [{ name: "SlimeKeys Preset", extensions: ["json"] }],
      });
      if (!selected) {
        return;
      }

      await invoke("export_preset_file", {
        path: withJsonExtension(selected),
        preset: selectedPreset,
      });
      pushLog(`${t("presetExported")}: ${selectedPreset.name}`);
    } catch (error) {
      pushLog(`${t("presetExportFailed")}: ${readableError(error)}`);
    }
  }

  async function handleDeletePreset() {
    if (presets.length <= 1) {
      pushLog(t("cannotDeleteLastPreset"));
      return;
    }

    const shouldDelete = await confirm(t("deletePresetConfirm"), {
      title: "SlimeKeys",
      kind: "warning",
      okLabel: t("deletePreset"),
      cancelLabel: t("cancel"),
    });
    if (!shouldDelete) {
      return;
    }

    const result = deletePresetById(presets, selectedPreset.id);
    setPresets(result.presets);
    setSelectedPresetId(result.selectedPresetId);
    pushLog(result.deleted ? t("presetDeleted") : t("cannotDeleteLastPreset"));
  }

  function handleRecordHotkey(action: HotkeyAction) {
    if (recordingAction === action) {
      setRecordingAction(null);
      pushLog(t("hotkeyRecordingCancelled"));
      return;
    }

    setRecordingAction(action);
    pushLog(`${t("hotkeyRecording")}: ${t(hotkeyActionLabels[action])}`);
  }

  function handleClearHotkey(action: HotkeyAction) {
    updateHotkeys(
      hotkeys.map((binding) =>
        binding.action === action
          ? { ...binding, accelerator: "", enabled: false }
          : binding,
      ),
    );
    if (recordingAction === action) {
      setRecordingAction(null);
    }
    pushLog(`${t("hotkeyCleared")}: ${t(hotkeyActionLabels[action])}`);
  }

  function handleAddRule() {
    updateSelectedPreset(addRuleToPreset);
    pushLog(t("ruleAdded"));
  }

  function handleDeleteRule(ruleId: string) {
    updateSelectedPreset((preset) => removeRuleFromPreset(preset, ruleId));
    pushLog(t("ruleDeleted"));
  }

  function handleApplyBulkRules() {
    const enabledRuleCount = selectedPreset.rules.filter(
      (rule) => rule.enabled,
    ).length;
    if (enabledRuleCount === 0) {
      pushLog(t("noEnabledRules"));
      return;
    }

    updateSelectedPreset((preset) =>
      bulkUpdateRulesInPreset(preset, {
        eventType: bulkEventType,
        inputSource: bulkInputSource,
        pressDurationMs: bulkPressDurationMs,
        triggerMode: bulkTriggerMode,
      }),
    );
    pushLog(`${t("bulkRulesApplied")}: ${enabledRuleCount}`);
  }

  function handleSaveKeymap() {
    try {
      window.localStorage.setItem(
        KEYMAP_STORAGE_KEY,
        stringifyKeymap({
          presets,
          selectedPresetId: selectedPreset.id,
        }),
      );
      pushLog(t("keymapSaved"));
    } catch (error) {
      pushLog(`${t("keymapSaveFailed")}: ${readableError(error)}`);
    }
  }

  function patchRule(ruleId: string, patch: Partial<Rule>) {
    updateSelectedPreset((preset) => updateRuleInPreset(preset, ruleId, patch));
  }

  function commitRuleName(ruleId: string, value: string, fallback: string) {
    const name = value.trim();
    patchRule(ruleId, { name: name || fallback });
  }

  function commitRuleNote(
    rule: Rule,
    value: string,
    input: HTMLInputElement,
  ) {
    const note = parseSingleNoteInput(value);
    if (note === null) {
      input.value = noteInputValue(rule.note);
      pushLog(t("invalidNoteInput"));
      return;
    }

    patchRule(rule.id, { note: { kind: "single", value: note } });
  }

  function commitRuleKeys(
    rule: Rule,
    value: string,
    input: HTMLInputElement,
  ) {
    const keys = keysFromInput(value);
    if (keys.length === 0) {
      input.value = formatRuleKeys(rule);
      pushLog(t("invalidKeyInput"));
      return;
    }

    patchRule(rule.id, { output: { keys } });
  }

  function updateSelectedPreset(transform: (preset: Preset) => Preset) {
    setPresets((current) =>
      current.map((preset) =>
        preset.id === selectedPreset.id ? transform(preset) : preset,
      ),
    );
  }

  function updateHotkeys(nextHotkeys: HotkeyBinding[]) {
    persistHotkeys(nextHotkeys);
    setHotkeys(nextHotkeys);
  }

  function pushLog(message: string) {
    setLogs((current) => [message, ...current].slice(0, 8));
  }

  return (
    <main className="app-shell">
      <aside className="preset-panel" aria-label="Preset list">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <h1>SlimeKeys</h1>
            <p>MIDI to Keyboard</p>
          </div>
        </div>

        <div className="panel-actions">
          <button onClick={handleCreatePreset} title={t("newPreset")} type="button">
            <Plus size={16} />
          </button>
          <button onClick={() => void handleImportPreset()} title={t("importPreset")} type="button">
            <Import size={16} />
          </button>
          <button onClick={() => void handleExportPreset()} title={t("exportPreset")} type="button">
            <Download size={16} />
          </button>
          <button onClick={() => void handleDeletePreset()} title={t("deletePreset")} type="button">
            <Trash2 size={16} />
          </button>
        </div>

        {presets.map((preset) => {
          const presetSummary = summarizePreset(preset);
          return (
            <button
              className={`preset ${preset.id === selectedPreset.id ? "active" : ""}`}
              key={preset.id}
              onClick={() => setSelectedPresetId(preset.id)}
              type="button"
            >
              <span>{preset.name}</span>
              <small>{presetSummary.enabledRules} enabled rules</small>
            </button>
          );
        })}
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div className="tool-group">
            <button className="command primary" onClick={handleOpenMidi} type="button">
              <FolderOpen size={16} />
              <span>{t("openMidi")}</span>
            </button>
            <button
              className="icon-command"
              onClick={() => void moveSong(-1)}
              title={t("hotkeyPrevious")}
              type="button"
            >
              <SkipBack size={16} />
            </button>
            <button className="icon-command" onClick={handlePlay} title={t("play")} type="button">
              <Play size={16} />
            </button>
            <button
              className="icon-command"
              disabled={!playbackActive}
              onClick={handlePause}
              title={t("pause")}
              type="button"
            >
              <Pause size={16} />
            </button>
            <button className="icon-command" onClick={handleStop} title={t("stop")} type="button">
              <Square size={16} />
            </button>
            <button
              className="icon-command"
              onClick={() => void moveSong(1)}
              title={t("hotkeyNext")}
              type="button"
            >
              <SkipForward size={16} />
            </button>
          </div>

          <div className="tool-group settings">
            <label>
              {t("speed")}
              <input value={selectedPreset.playback.speed.toFixed(2)} readOnly />
            </label>
            <label>
              {t("transpose")}
              <input value={selectedPreset.playback.transpose} readOnly />
            </label>
            <label>
              {t("delay")}
              <input value={`${selectedPreset.playback.globalDelayMs} ms`} readOnly />
            </label>
          </div>

          <div className="tool-group live-input">
            <RadioTower size={16} />
            <select
              aria-label={t("midiInput")}
              onChange={(event) => setSelectedInputId(event.target.value)}
              value={selectedInputId}
            >
              {midiInputs.length === 0 ? (
                <option value="">{t("noMidiDeviceFound")}</option>
              ) : (
                midiInputs.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                    {device.availableForLive ? "" : ` (${t("detectedOnly")})`}
                  </option>
                ))
              )}
            </select>
            <button
              className="icon-command"
              onClick={() => void refreshMidiInputs(false)}
              title={t("refreshMidi")}
              type="button"
            >
              <RefreshCw size={16} />
            </button>
            <label className="switch">
              <input
                checked={liveEnabled}
                disabled={!!selectedMidiInput && !selectedMidiInput.availableForLive}
                onChange={(event) => void handleLiveToggle(event.target.checked)}
                type="checkbox"
              />
              <span>{t("live")}</span>
            </label>
            <label className="language-switch">
              <Languages size={16} />
              <select
                aria-label={t("language")}
                onChange={(event) => setLanguage(event.target.value as Language)}
                value={language}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </header>

        <section className={`status-line ${playbackActive ? "playing" : ""}`}>
          <span>{openedFile}</span>
          <span>{summary.enabledRules} enabled rules</span>
          <span>{summary.triggerModes.map(triggerModeLabel).join(", ")}</span>
          {playbackActive ? (
            <span className="playback-status">
              <span className="playback-status-dot" />
              {t("playingNow")}
            </span>
          ) : null}
          {selectedMidiInput && !selectedMidiInput.availableForLive ? (
            <span>{selectedMidiInput.note ?? t("midiServicesDetected")}</span>
          ) : null}
        </section>

        <section
          className={`playback-progress ${playbackActive ? "active" : ""}`}
          aria-label={t("songProgress")}
        >
          <span>{formatPlaybackTime(displayedPlaybackMs)}</span>
          <input
            aria-label={t("songProgress")}
            disabled={!openedPath || songDurationMs === 0}
            max={Math.max(songDurationMs, 0)}
            min={0}
            onChange={(event) => handleSeekInput(event.target.value)}
            onKeyUp={(event) => {
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                  "PageUp",
                  "PageDown",
                ].includes(event.key)
              ) {
                void commitSeek();
              }
            }}
            onPointerUp={() => void commitSeek()}
            step={100}
            type="range"
            value={clampPlaybackMs(displayedPlaybackMs, songDurationMs)}
          />
          <span>{formatPlaybackTime(songDurationMs)}</span>
        </section>

        <section className="content-grid">
          <section className="rules-section">
            <div className="section-heading">
              <div>
                <h2>{t("rules")}</h2>
                <p>{t("triggerHint")}</p>
              </div>
              <div className="section-actions">
                <button
                  className="command"
                  onClick={handleSaveKeymap}
                  type="button"
                >
                  <Save size={16} />
                  <span>{t("saveKeymap")}</span>
                </button>
                <button
                  className="command"
                  onClick={handleAddRule}
                  type="button"
                >
                  <Plus size={16} />
                  <span>{t("addRule")}</span>
                </button>
              </div>
            </div>

            <div className="rule-tools" aria-label={t("bulkRules")}>
              <strong>{t("bulkRules")}</strong>
              <label>
                <span>{t("event")}</span>
                <select
                  className="rule-field"
                  onChange={(event) =>
                    setBulkEventType(event.target.value as MidiEventType)
                  }
                  value={bulkEventType}
                >
                  {EVENT_TYPES.map((eventType) => (
                    <option key={eventType} value={eventType}>
                      {eventTypeLabel(eventType)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("source")}</span>
                <select
                  className="rule-field"
                  onChange={(event) =>
                    setBulkInputSource(event.target.value as InputSource)
                  }
                  value={bulkInputSource}
                >
                  {INPUT_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("mode")}</span>
                <select
                  className="rule-field"
                  onChange={(event) =>
                    setBulkTriggerMode(event.target.value as TriggerMode)
                  }
                  value={bulkTriggerMode}
                >
                  {TRIGGER_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {triggerModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="short-field">
                <span>{t("pressMs")}</span>
                <input
                  className="rule-field"
                  min={1}
                  onChange={(event) =>
                    setBulkPressDurationMs(
                      clampInteger(
                        event.target.value,
                        bulkPressDurationMs,
                        1,
                        5000,
                      ),
                    )
                  }
                  type="number"
                  value={bulkPressDurationMs}
                />
              </label>
              <button
                className="command"
                onClick={handleApplyBulkRules}
                type="button"
              >
                <SlidersHorizontal size={16} />
                <span>{t("applyBulkRules")}</span>
              </button>
            </div>

            <div className="rule-table" role="table" aria-label="Rule table">
              <div className="rule-row header" role="row">
                <span>On</span>
                <span>{t("ruleName")}</span>
                <span>{t("note")}</span>
                <span>{t("event")}</span>
                <span>{t("source")}</span>
                <span>{t("keys")}</span>
                <span>{t("mode")}</span>
                <span>{t("pressMs")}</span>
                <span />
              </div>
              {selectedPreset.rules.map((rule) => (
                <div className="rule-row" role="row" key={rule.id}>
                  <span>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) =>
                        patchRule(rule.id, { enabled: event.target.checked })
                      }
                    />
                  </span>
                  <span>
                    <input
                      className="rule-field"
                      defaultValue={rule.name}
                      onBlur={(event) =>
                        commitRuleName(rule.id, event.target.value, rule.name)
                      }
                      type="text"
                    />
                  </span>
                  <span>
                    <input
                      className="rule-field"
                      defaultValue={noteInputValue(rule.note)}
                      onBlur={(event) =>
                        commitRuleNote(rule, event.target.value, event.target)
                      }
                      title="C4 / C#4 / 60"
                      type="text"
                    />
                  </span>
                  <span>
                    <select
                      className="rule-field"
                      value={rule.eventType}
                      onChange={(event) =>
                        patchRule(rule.id, {
                          eventType: event.target.value as MidiEventType,
                        })
                      }
                    >
                      {EVENT_TYPES.map((eventType) => (
                        <option key={eventType} value={eventType}>
                          {eventTypeLabel(eventType)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <select
                      className="rule-field"
                      value={rule.inputSource}
                      onChange={(event) =>
                        patchRule(rule.id, {
                          inputSource: event.target.value as InputSource,
                        })
                      }
                    >
                      {INPUT_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <input
                      className="rule-field"
                      defaultValue={formatRuleKeys(rule)}
                      onBlur={(event) =>
                        commitRuleKeys(rule, event.target.value, event.target)
                      }
                      title="A / Ctrl + A"
                      type="text"
                    />
                  </span>
                  <span>
                    <select
                      className="rule-field"
                      value={rule.triggerMode}
                      onChange={(event) =>
                        patchRule(rule.id, {
                          triggerMode: event.target.value as TriggerMode,
                        })
                      }
                    >
                      {TRIGGER_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {triggerModeLabel(mode)}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <input
                      className="rule-field"
                      min={1}
                      onChange={(event) =>
                        patchRule(rule.id, {
                          pressDurationMs: clampInteger(
                            event.target.value,
                            rule.pressDurationMs,
                            1,
                            5000,
                          ),
                        })
                      }
                      type="number"
                      value={rule.pressDurationMs}
                    />
                  </span>
                  <span>
                    <button
                      className="icon-command"
                      onClick={() => handleDeleteRule(rule.id)}
                      title={t("deleteRule")}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="inspector">
            <h2>{t("output")}</h2>
            <div className="output-toggle">
              <Keyboard size={18} />
              <div>
                <strong>
                  {outputEnabled ? t("keyOutputEnabled") : t("keyOutputDisabled")}
                </strong>
                <span>{t("outputSafety")}</span>
              </div>
              <label className="switch">
                <input
                  checked={outputEnabled}
                  onChange={(event) => void handleOutputToggle(event.target.checked)}
                  type="checkbox"
                />
                <span>{t("output")}</span>
              </label>
            </div>

            <button className="command danger release-command" onClick={handleReleaseAll} type="button">
              <Save size={16} />
              <span>{t("releaseAllKeys")}</span>
            </button>

            <h2>{t("hotkeys")}</h2>
            <div className="hotkey-list">
              {hotkeys.map((binding) => {
                const isRecording = recordingAction === binding.action;
                const hasHotkey = binding.enabled && binding.accelerator;
                const hotkeyLabel = isRecording
                  ? t("hotkeyRecordingShort")
                  : hasHotkey
                    ? binding.accelerator
                    : t("hotkeyClickToSet");

                return (
                  <div
                    className={`hotkey-row${
                      isRecording ? " is-recording" : ""
                    }`}
                    key={binding.action}
                  >
                    <span className="hotkey-action-label">
                      {t(hotkeyActionLabels[binding.action])}
                    </span>
                    <button
                      aria-label={`${t("recordHotkey")}: ${t(
                        hotkeyActionLabels[binding.action],
                      )}`}
                      className={`hotkey-trigger${hasHotkey ? "" : " is-empty"}`}
                      onClick={() => handleRecordHotkey(binding.action)}
                      title={
                        isRecording ? t("hotkeyRecordingHint") : t("recordHotkey")
                      }
                      type="button"
                    >
                      <Keyboard size={15} />
                      <span>{hotkeyLabel}</span>
                    </button>
                    <button
                      className="icon-command"
                      disabled={!binding.accelerator}
                      onClick={() => handleClearHotkey(binding.action)}
                      title={t("clearHotkey")}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })}
            </div>

            <h2>{t("recentEvents")}</h2>
            <div className="log-list">
              {logs.map((log) => (
                <p key={log}>
                  <FileMusic size={14} /> {log}
                </p>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

function loadInitialKeymap() {
  const storedKeymap = loadStoredKeymap();
  const presets = storedKeymap?.presets ?? [fallbackGenshinPreset()];
  return {
    presets,
    selectedPresetId: selectedPresetIdFor(presets, storedKeymap?.selectedPresetId),
  };
}

function loadStoredKeymap() {
  try {
    return parseStoredKeymap(window.localStorage.getItem(KEYMAP_STORAGE_KEY));
  } catch {
    return null;
  }
}

function selectedPresetIdFor(presets: Preset[], preferredId?: string) {
  if (preferredId && presets.some((preset) => preset.id === preferredId)) {
    return preferredId;
  }

  return presets[0]?.id ?? "genshin-21-key";
}

function loadStoredHotkeys(): HotkeyBinding[] {
  try {
    const saved = window.localStorage.getItem(HOTKEY_STORAGE_KEY);
    const hotkeys = mergeSavedHotkeys(saved ? JSON.parse(saved) : null);
    return validateHotkeyBindings(hotkeys).ok ? hotkeys : DEFAULT_HOTKEYS;
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

function persistHotkeys(hotkeys: HotkeyBinding[]) {
  try {
    window.localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(hotkeys));
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function clampInteger(
  value: string,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;

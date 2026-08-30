import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import {
  Download,
  FileMusic,
  FolderOpen,
  Import,
  Keyboard,
  Languages,
  Palette,
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
  Volume2,
} from "lucide-react";
import type {
  AppSnapshot,
  HotkeyAction,
  HotkeyBinding,
  InputSource,
  MidiEvent,
  MidiEventType,
  MidiInputDevice,
  AudioOutputDevice,
  PlaybackOutputMode,
  PlaybackTrackState,
  PlaylistPlaybackMode,
  Preset,
  Rule,
  ScoreEditAction,
  ScoreEditorState,
  SongEntry,
  TrackSummary,
  TriggerMode,
  WorkspaceTab,
} from "./types";
import { ScoreEditor } from "./components/ScoreEditor";
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
  enabledHotkeyShortcuts,
  hotkeyActionFromKeyboardEvent,
  HOTKEY_ACTIONS,
  mergeSavedHotkeys,
  normalizeAccelerator,
  shouldHandleShortcutEvent,
  validateHotkeyBindings,
} from "./lib/hotkeys";
import { replaceRegisteredHotkeys } from "./lib/hotkeyRegistration";
import {
  AUDIO_OUTPUT_STORAGE_KEY,
  effectiveAudioOutputId,
  parseStoredAudioOutput,
  selectedAudioOutputValue,
  storedAudioOutputFromSelection,
} from "./lib/audioOutput";
import { parseStoredKeymap, stringifyKeymap } from "./lib/keymapStorage";
import { appendLogEntry } from "./lib/logs";
import { medleyPlaybackStartMs } from "./lib/medleyMode";
import {
  eventsFromNotes,
  moveNonNoteEventsWithSelectedNotes,
  notesFromEvents,
  nonNoteEventsFromEvents,
  summarizeTracks,
} from "./lib/midiNotes";
import {
  eventTypeLabel,
  fallbackBuiltInPresets,
  mergeBuiltInPresets,
  summarizePreset,
  triggerModeLabel,
} from "./lib/presets";
import {
  clampPlaybackSpeed,
  clampPlaybackMs,
  formatPlaybackTime,
  midiDurationMs,
  playbackPositionAtElapsedMs,
  playbackStartMs,
} from "./lib/playbackProgress";
import { playbackOutputModeForToggles } from "./lib/playbackMode";
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
import {
  clearScoreSelection,
  copySelectedScoreNotes,
  createScoreEditorState,
  cutSelectedScoreNotes,
  deleteSelectedScoreNotes,
  moveSelectedScoreNotes,
  pasteScoreClipboardAt,
  redoScoreEdit,
  resizeSelectedScoreNotes,
  selectAllScoreNotes,
  setScoreSelection,
  transposeSelectedScoreNotes,
  undoScoreEdit,
} from "./lib/scoreHistory";
import {
  displayPlaylistForMove,
  nextSongAfterPlaybackEnd,
  selectRelativeSong,
  songEntryFromPath,
} from "./lib/songQueue";
import {
  parseStoredThemePreference,
  resolveThemePreference,
  type ThemePreference,
} from "./lib/theme";

const HOTKEY_STORAGE_KEY = "slimekeys.hotkeys.v2";
const LEGACY_HOTKEY_STORAGE_KEY = "slimekeys.hotkeys.v1";
const HOTKEY_PASSTHROUGH_STORAGE_KEY = "slimekeys.hotkeys.passthrough.v1";
const AUDITION_OUTPUT_STORAGE_KEY = "slimekeys.auditionOutput.v1";
const KEYMAP_STORAGE_KEY = "slimekeys.keymap.v1";
const MEDLEY_MODE_STORAGE_KEY = "slimekeys.medleyMode.v1";
const PLAYLIST_AUTO_ADVANCE_STORAGE_KEY = "slimekeys.playlistAutoAdvance.v1";
const PLAYLIST_PLAYBACK_MODE_STORAGE_KEY = "slimekeys.playlistMode.v1";
const THEME_STORAGE_KEY = "slimekeys.theme.v1";
const PASSTHROUGH_HOTKEY_EVENT = "slimekeys://hotkey";
const PLAYBACK_SPEED_STEP = 0.05;
const TRACK_SWITCHING_ENABLED =
  import.meta.env.VITE_SLIMEKEYS_DISABLE_TRACK_SWITCHING !== "true";
const EVENT_TYPES: MidiEventType[] = ["noteOn", "noteOff", "both"];
const INPUT_SOURCES: InputSource[] = ["all", "file", "live"];
const TRIGGER_MODES: TriggerMode[] = ["tap", "hold", "retrigger", "chop"];
const PLAYLIST_PLAYBACK_MODES: PlaylistPlaybackMode[] = [
  "sequential",
  "repeatOne",
  "repeatAll",
  "shuffle",
];
const PLAYLIST_PLAYBACK_MODE_LABEL_KEYS: Record<
  PlaylistPlaybackMode,
  TranslationKey
> = {
  sequential: "playlistModeSequential",
  repeatOne: "playlistModeRepeatOne",
  repeatAll: "playlistModeRepeatAll",
  shuffle: "playlistModeShuffle",
};
const PLAYLIST_PLAYBACK_MODE_HINT_KEYS: Record<
  PlaylistPlaybackMode,
  TranslationKey
> = {
  sequential: "playlistModeSequentialHint",
  repeatOne: "playlistModeRepeatOneHint",
  repeatAll: "playlistModeRepeatAllHint",
  shuffle: "playlistModeShuffleHint",
};

interface PassthroughHotkeyInstallResult {
  installed: { action: HotkeyAction; accelerator: string }[];
  failed: { action: string; accelerator: string; error: string }[];
}

function App() {
  const initialKeymap = useMemo(() => loadInitialKeymap(), []);
  const [language, setLanguage] = useState<Language>(() =>
    typeof navigator === "undefined"
      ? defaultLanguage
      : detectLanguage(navigator.language),
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    loadStoredThemePreference,
  );
  const [prefersDark, setPrefersDark] = useState(prefersDarkColorScheme);
  const [presets, setPresets] = useState<Preset[]>(initialKeymap.presets);
  const [selectedPresetId, setSelectedPresetId] = useState(
    initialKeymap.selectedPresetId,
  );
  const [midiInputs, setMidiInputs] = useState<MidiInputDevice[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<AudioOutputDevice[]>([]);
  const [storedAudioOutput, setStoredAudioOutput] = useState(
    loadStoredAudioOutput,
  );
  const [selectedInputId, setSelectedInputId] = useState("");
  const [outputEnabled, setOutputEnabled] = useState(false);
  const [auditionEnabled, setAuditionEnabled] = useState(
    loadStoredAuditionEnabled,
  );
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [medleyMode, setMedleyMode] = useState(loadStoredMedleyMode);
  const [playlistAutoAdvance, setPlaylistAutoAdvance] = useState(
    loadStoredPlaylistAutoAdvance,
  );
  const [playlistPlaybackMode, setPlaylistPlaybackMode] =
    useState<PlaylistPlaybackMode>(loadStoredPlaylistPlaybackMode);
  const [openedPath, setOpenedPath] = useState("");
  const [openedFile, setOpenedFile] = useState<string>("");
  const [midiEvents, setMidiEvents] = useState<MidiEvent[]>([]);
  const [preservedMidiEvents, setPreservedMidiEvents] = useState<MidiEvent[]>([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<WorkspaceTab>("rules");
  const [scoreEditor, setScoreEditor] = useState<ScoreEditorState>(() =>
    createScoreEditorState([]),
  );
  const [trackSummaries, setTrackSummaries] = useState<TrackSummary[]>([]);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playlist, setPlaylist] = useState<SongEntry[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [hotkeys, setHotkeys] = useState<HotkeyBinding[]>(() =>
    loadStoredHotkeys(),
  );
  const [passthroughHotkeys, setPassthroughHotkeys] = useState(
    loadStoredPassthroughHotkeys,
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
    pause: () => undefined,
    stop: () => undefined,
    next: () => undefined,
    previous: () => undefined,
    nextPreset: () => undefined,
    previousPreset: () => undefined,
    toggleKeyOutput: () => undefined,
    toggleAudition: () => undefined,
    speedDown: () => undefined,
    speedUp: () => undefined,
    toggleTrack1: () => undefined,
    toggleTrack2: () => undefined,
    toggleTrack3: () => undefined,
    toggleTrack4: () => undefined,
    toggleTrack5: () => undefined,
    toggleTrack6: () => undefined,
    toggleTrack7: () => undefined,
    toggleTrack8: () => undefined,
    toggleTrack9: () => undefined,
    releaseAll: () => undefined,
  });
  const lastLocalHotkeyRef = useRef<{
    action: HotkeyAction;
    at: number;
  } | null>(null);
  const hotkeyRegistrationRunRef = useRef(0);
  const progressTimerRef = useRef<number | null>(null);
  const progressStartedAtRef = useRef(0);
  const progressOffsetMsRef = useRef(0);
  const progressSpeedRef = useRef(1);
  const pendingSeekMsRef = useRef<number | null>(null);
  const playlistRef = useRef<SongEntry[]>([]);
  const currentSongIndexRef = useRef(0);
  const playlistPlaybackModeRef = useRef<PlaylistPlaybackMode>(
    playlistPlaybackMode,
  );
  const playlistAutoAdvanceRef = useRef(playlistAutoAdvance);
  const playbackOutputModeRef = useRef<PlaybackOutputMode>("keys");
  const medleyModeRef = useRef(medleyMode);
  const t = useMemo(() => createTranslator(language), [language]);
  const tRef = useRef(t);
  const currentPlaybackOutputMode = useMemo(
    () =>
      playbackOutputModeForToggles({
        keyOutputEnabled: outputEnabled,
        auditionEnabled,
      }),
    [auditionEnabled, outputEnabled],
  );
  const configurableHotkeys = useMemo(
    () => hotkeys.filter((binding) => shouldExposeHotkey(binding.action)),
    [hotkeys],
  );
  const resolvedTheme = useMemo(
    () => resolveThemePreference(themePreference, prefersDark),
    [prefersDark, themePreference],
  );

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    currentSongIndexRef.current = currentSongIndex;
  }, [currentSongIndex]);

  useEffect(() => {
    playlistPlaybackModeRef.current = playlistPlaybackMode;
  }, [playlistPlaybackMode]);

  useEffect(() => {
    playlistAutoAdvanceRef.current = playlistAutoAdvance;
  }, [playlistAutoAdvance]);

  useEffect(() => {
    medleyModeRef.current = medleyMode;
  }, [medleyMode]);

  useEffect(() => {
    setMidiEvents(eventsFromNotes(scoreEditor.notes, preservedMidiEvents));
  }, [preservedMidiEvents, scoreEditor.notes]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) {
      return;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };

    setPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

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
      pause: () => void handlePause(),
      stop: () => void stopPlayback(true),
      next: () => void moveSong(1),
      previous: () => void moveSong(-1),
      nextPreset: () => movePreset(1),
      previousPreset: () => movePreset(-1),
      toggleKeyOutput: () => void handleOutputToggle(!outputEnabled),
      toggleAudition: () => void handleAuditionToggle(!auditionEnabled),
      speedDown: () => handlePlaybackSpeedStep(-PLAYBACK_SPEED_STEP),
      speedUp: () => handlePlaybackSpeedStep(PLAYBACK_SPEED_STEP),
      toggleTrack1: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(0);
      },
      toggleTrack2: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(1);
      },
      toggleTrack3: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(2);
      },
      toggleTrack4: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(3);
      },
      toggleTrack5: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(4);
      },
      toggleTrack6: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(5);
      },
      toggleTrack7: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(6);
      },
      toggleTrack8: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(7);
      },
      toggleTrack9: () => {
        if (TRACK_SWITCHING_ENABLED) handleToggleTrackHotkey(8);
      },
      releaseAll: () => void handleReleaseAll(),
    };
  });

  useEffect(() => {
    if (recordingAction) {
      return;
    }

    const handleLocalHotkey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const action = hotkeyActionFromKeyboardEvent(configurableHotkeys, {
        altKey: event.altKey,
        code: event.code,
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
        isContentEditable: target?.isContentEditable,
        key: event.key,
        metaKey: event.metaKey,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
        targetTagName: target?.tagName,
      });
      if (!action) {
        return;
      }

      event.preventDefault();
      lastLocalHotkeyRef.current = { action, at: performance.now() };
      runHotkeyAction(action, "local");
    };

    window.addEventListener("keydown", handleLocalHotkey);
    return () => window.removeEventListener("keydown", handleLocalHotkey);
  }, [configurableHotkeys, recordingAction]);

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
      const validation = validateHotkeyBindings(
        nextHotkeys.filter((binding) => shouldExposeHotkey(binding.action)),
      );
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

  useEffect(
    () => () => {
      hotkeyRegistrationRunRef.current += 1;
      void unregisterAll().catch(() => undefined);
      void invoke("clear_passthrough_hotkeys").catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    void listen<HotkeyAction>(PASSTHROUGH_HOTKEY_EVENT, (event) => {
      const action = event.payload;
      if (isHotkeyAction(action)) {
        window.setTimeout(() => runHotkeyAction(action, "global"), 0);
      }
    }).then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const runId = hotkeyRegistrationRunRef.current + 1;
    hotkeyRegistrationRunRef.current = runId;

    const validation = validateHotkeyBindings(configurableHotkeys);
    if (!validation.ok) {
      const translate = tRef.current;
      pushLog(
        validation.error === "duplicate"
          ? translate("hotkeyDuplicate")
          : translate("hotkeyInvalid"),
      );
      void unregisterAll().catch(() => undefined);
      void invoke("clear_passthrough_hotkeys").catch(() => undefined);
      return;
    }

    const enabledBindings = configurableHotkeys.filter((binding) => binding.enabled);
    const actionByShortcut = new Map(
      enabledBindings.map((binding) => [
        normalizeAccelerator(binding.accelerator).toLowerCase(),
        binding.action,
      ]),
    );

    void (async () => {
      try {
        if (passthroughHotkeys) {
          await unregisterAll().catch(() => undefined);
          const result = await invoke<PassthroughHotkeyInstallResult>(
            "set_passthrough_hotkeys",
            {
              hotkeys: enabledBindings,
            },
          );
          if (hotkeyRegistrationRunRef.current === runId) {
            logHotkeyInstallResult(result.failed);
          }
          return;
        }

        await invoke("clear_passthrough_hotkeys").catch(() => undefined);
        const shortcuts = enabledHotkeyShortcuts(enabledBindings);
        const result = await replaceRegisteredHotkeys({
          shortcuts,
          unregisterAll,
          isCurrent: () => hotkeyRegistrationRunRef.current === runId,
          register: async (nextShortcuts, handler) => {
            await register(nextShortcuts, (event) => handler(event));
          },
          handler: (event) => {
            if (!shouldHandleShortcutEvent(event.state)) {
              return;
            }

            const action = actionByShortcut.get(
              normalizeAccelerator(event.shortcut).toLowerCase(),
            );
            if (action) {
              window.setTimeout(() => runHotkeyAction(action, "global"), 80);
            }
          },
        });

        if (hotkeyRegistrationRunRef.current === runId) {
          logHotkeyInstallResult(result.failedShortcuts);
        }
      } catch (error) {
        if (hotkeyRegistrationRunRef.current === runId) {
          pushLog(
            `${tRef.current("hotkeyRegistrationFailed")}: ${readableError(
              error,
            )}`,
          );
        }
      }
    })();
  }, [configurableHotkeys, passthroughHotkeys]);

  function runHotkeyAction(action: HotkeyAction, source: "global" | "local") {
    if (!shouldExposeHotkey(action)) {
      return;
    }

    if (source === "global") {
      const lastLocalHotkey = lastLocalHotkeyRef.current;
      if (
        lastLocalHotkey?.action === action &&
        performance.now() - lastLocalHotkey.at < 700
      ) {
        return;
      }
    }

    hotkeyHandlersRef.current[action]();
  }

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const selectedPresetRef = useRef(selectedPreset);
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

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);
  const hotkeyActionLabels: Record<HotkeyAction, TranslationKey> = {
    play: "hotkeyPlay",
    pause: "hotkeyPause",
    stop: "hotkeyStop",
    next: "hotkeyNext",
    previous: "hotkeyPrevious",
    nextPreset: "hotkeyNextPreset",
    previousPreset: "hotkeyPreviousPreset",
    toggleKeyOutput: "hotkeyToggleKeyOutput",
    toggleAudition: "hotkeyToggleAudition",
    speedDown: "hotkeySpeedDown",
    speedUp: "hotkeySpeedUp",
    toggleTrack1: "hotkeyToggleTrack1",
    toggleTrack2: "hotkeyToggleTrack2",
    toggleTrack3: "hotkeyToggleTrack3",
    toggleTrack4: "hotkeyToggleTrack4",
    toggleTrack5: "hotkeyToggleTrack5",
    toggleTrack6: "hotkeyToggleTrack6",
    toggleTrack7: "hotkeyToggleTrack7",
    toggleTrack8: "hotkeyToggleTrack8",
    toggleTrack9: "hotkeyToggleTrack9",
    releaseAll: "hotkeyReleaseAll",
  };

  async function loadBackendState() {
    try {
      const snapshot = await invoke<AppSnapshot>("get_app_snapshot");
      const storedKeymap = loadStoredKeymap();
      const nextPresets = mergeBuiltInPresets(
        storedKeymap?.presets ?? snapshot.presets,
        snapshot.presets,
      );
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
        const nextPresets = mergeBuiltInPresets(storedKeymap.presets);
        setPresets(nextPresets);
        setSelectedPresetId(
          selectedPresetIdFor(nextPresets, storedKeymap.selectedPresetId),
        );
        pushLog(t("keymapLoaded"));
      } else {
        pushLog(t("previewMode"));
      }
    }

    await refreshMidiInputs(true);
    await refreshAudioOutputs(true);
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

  async function refreshAudioOutputs(silent = false) {
    try {
      const devices = await invoke<AudioOutputDevice[]>("list_audio_outputs");
      setAudioOutputs(devices);
      const effective = effectiveAudioOutputId(storedAudioOutput, devices);
      await invoke<AudioOutputDevice | null>("set_audio_output_device", {
        deviceId: effective,
      });
      if (!silent && devices.length === 0) {
        pushLog(t("noAudioOutputDeviceFound"));
      }
      if (
        !silent &&
        storedAudioOutput.deviceId &&
        !storedAudioOutput.followSystemDefault &&
        effective === null &&
        devices.length > 0
      ) {
        pushLog(t("audioOutputFallbackLog"));
      }
    } catch {
      setAudioOutputs([]);
      if (!silent) {
        pushLog(t("noAudioOutputDeviceFound"));
      }
    }
  }

  async function handleAudioOutputChange(value: string) {
    const next = storedAudioOutputFromSelection(value);
    setStoredAudioOutput(next);
    try {
      window.localStorage.setItem(AUDIO_OUTPUT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
    try {
      await invoke("set_audio_output_device", {
        deviceId: next.followSystemDefault ? null : next.deviceId,
      });
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
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
      const displayPlaylist =
        songs.length === 1
          ? await playlistNearSong(songs[0])
          : { songs, currentIndex: 0 };
      setPlaylist(displayPlaylist.songs);
      setCurrentSongIndex(displayPlaylist.currentIndex);
      await loadSong(songs[0], true);
    } catch (error) {
      pushLog(`${t("openMidiFailed")}: ${readableError(error)}`);
    }
  }

  async function playlistNearSong(song: SongEntry) {
    try {
      const folderSongs = (
        await invoke<string[]>("list_midi_files_near", {
          path: song.path,
        })
      ).map(songEntryFromPath);
      return displayPlaylistForMove({
        existingPlaylist: [],
        folderSongs,
        selectedSong: song,
      });
    } catch {
      return { songs: [song], currentIndex: 0 };
    }
  }

  async function handlePlay() {
    const startAtMs = playbackStartMs(playbackPositionMs, songDurationMs);
    await playSong(currentSong, startAtMs, currentPlaybackOutputMode);
  }

  async function handlePause() {
    await pausePlayback(true);
  }

  async function playSong(
    song: SongEntry | null,
    startAtMs = 0,
    outputMode: PlaybackOutputMode = "keys",
  ) {
    if (!song) {
      pushLog(t("openBeforePlayback"));
      return;
    }

    try {
      let events = midiEvents;
      if (song.path !== openedPath) {
        events = await loadSong(song, false);
      }
      await startPlayback(
        song,
        startAtMs,
        midiDurationMs(events),
        selectedPreset,
        outputMode,
        events,
      );
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  async function startPlayback(
    song: SongEntry,
    startAtMs = 0,
    durationMs = songDurationMs,
    preset = selectedPreset,
    outputMode: PlaybackOutputMode = "keys",
    events = midiEvents,
    logPlayback = true,
    seamless = false,
  ) {
    const seekMs = clampPlaybackMs(startAtMs, durationMs);
    const playbackEvents = events;
    if (outputMode !== "keys" && audioOutputs.length === 0) {
      throw new Error(t("noAudioOutputDeviceFound"));
    }
    const playedCount = await invoke<number>("play_midi_events_from", {
      events: playbackEvents,
      startAtMs: seekMs,
      preset,
      outputMode,
      playbackTracks: TRACK_SWITCHING_ENABLED
        ? playbackTrackStatesFor(trackSummaries)
        : [],
      seamless,
    });
    playbackOutputModeRef.current = outputMode;
    beginProgress(seekMs, durationMs, preset.playback.speed);
    if (logPlayback && outputMode !== "audition" && !outputEnabled) {
      pushLog(t("outputDisabledPlaybackWarning"));
    }
    if (logPlayback && outputMode === "audition" && audioOutputs.length === 0) {
      pushLog(t("noAudioOutputDeviceFound"));
    }
    if (logPlayback) {
      pushLog(`${t("playbackStarted")}: ${playedCount}`);
    }
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
    const notes = notesFromEvents(events);
    const preservedEvents = nonNoteEventsFromEvents(events);
    setPreservedMidiEvents(preservedEvents);
    setScoreEditor(createScoreEditorState(notes));
    setTrackSummaries(summarizeTracks(notes));
    setMidiEvents(eventsFromNotes(notes, preservedEvents));
    setActiveWorkspaceTab("score");
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
      const displayPlaylist = displayPlaylistForMove({
        existingPlaylist: playlist,
        folderSongs,
        selectedSong,
      });
      setPlaylist(displayPlaylist.songs);
      setCurrentSongIndex(displayPlaylist.currentIndex);
      const events = await loadSong(selectedSong, false);
      const durationMs = midiDurationMs(events);
      const startAtMs =
        direction === 1 && medleyMode
          ? medleyPlaybackStartMs(events, selectedPreset.rules)
          : 0;
      if (startAtMs > 0) {
        pushLog(`${t("medleySkippedIntro")}: ${formatPlaybackTime(startAtMs)}`);
      }
      await startPlayback(
        selectedSong,
        startAtMs,
        durationMs,
        selectedPreset,
        "keys",
        events,
      );
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  async function handleSelectPlaylistSong(index: number) {
    const song = playlist[index];
    if (!song) {
      return;
    }

    const shouldResume = playbackActive;
    try {
      await stopPlayback(false);
      setCurrentSongIndex(index);
      const events = await loadSong(song, false);
      if (shouldResume) {
        await startPlayback(song, 0, midiDurationMs(events), selectedPreset, "keys", events);
      }
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  function handleSeekInput(value: string) {
    const seekMs = clampPlaybackMs(Number(value), songDurationMs);
    pendingSeekMsRef.current = seekMs;
    setPendingSeekMs(seekMs);
  }

  async function commitSeek(nextValue?: string) {
    const pendingSeek =
      nextValue === undefined
        ? pendingSeekMsRef.current ?? pendingSeekMs
        : Number(nextValue);
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
      await startPlayback(
        currentSong,
        seekMs,
        songDurationMs,
        selectedPreset,
        currentPlaybackOutputMode,
        midiEvents,
      );
    } catch (error) {
      stopProgress(false);
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  function beginProgress(startAtMs: number, durationMs: number, speed: number) {
    clearProgressTimer();
    const clampedStart = clampPlaybackMs(startAtMs, durationMs);
    progressStartedAtRef.current = performance.now();
    progressOffsetMsRef.current = clampedStart;
    progressSpeedRef.current = clampPlaybackSpeed(speed);
    setPlaybackPositionMs(clampedStart);

    if (durationMs <= 0 || clampedStart >= durationMs) {
      setPlaybackActive(false);
      return;
    }

    setPlaybackActive(true);
    progressTimerRef.current = window.setInterval(() => {
      const elapsedMs = performance.now() - progressStartedAtRef.current;
      const nextPosition = playbackPositionAtElapsedMs(
        progressOffsetMsRef.current,
        elapsedMs,
        progressSpeedRef.current,
        durationMs,
      );
      setPlaybackPositionMs(nextPosition);
      if (nextPosition >= durationMs) {
        clearProgressTimer();
        setPlaybackActive(false);
        void handlePlaybackFinished();
      }
    }, 100);
  }

  async function handlePlaybackFinished() {
    const selection = nextSongAfterPlaybackEnd({
      playlist: playlistRef.current,
      currentIndex: currentSongIndexRef.current,
      mode: playlistPlaybackModeRef.current,
      autoAdvance: playlistAutoAdvanceRef.current,
    });
    if (!selection) {
      return;
    }

    try {
      setCurrentSongIndex(selection.index);
      const events = await loadSong(selection.song, false);
      const durationMs = midiDurationMs(events);
      const shouldSkipIntro =
        medleyModeRef.current && playlistPlaybackModeRef.current !== "repeatOne";
      const startAtMs = shouldSkipIntro
        ? medleyPlaybackStartMs(events, selectedPresetRef.current.rules)
        : 0;
      if (startAtMs > 0) {
        pushLog(`${t("medleySkippedIntro")}: ${formatPlaybackTime(startAtMs)}`);
      }
      await startPlayback(
        selection.song,
        startAtMs,
        durationMs,
        selectedPresetRef.current,
        playbackOutputModeRef.current,
        events,
      );
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  function currentPlaybackPositionMs(durationMs: number) {
    if (!playbackActive) {
      return clampPlaybackMs(playbackPositionMs, durationMs);
    }

    const elapsedMs = performance.now() - progressStartedAtRef.current;
    return playbackPositionAtElapsedMs(
      progressOffsetMsRef.current,
      elapsedMs,
      progressSpeedRef.current,
      durationMs,
    );
  }

  async function restartCurrentPlayback({
    durationMs = songDurationMs,
    events = midiEvents,
    logPlayback = false,
    outputMode = playbackOutputModeRef.current,
    preset = selectedPreset,
    seamless = true,
  }: {
    durationMs?: number;
    events?: MidiEvent[];
    logPlayback?: boolean;
    outputMode?: PlaybackOutputMode;
    preset?: Preset;
    seamless?: boolean;
  } = {}) {
    if (!playbackActive || !currentSong) {
      return;
    }

    const startAtMs = currentPlaybackPositionMs(songDurationMs);
    await startPlayback(
      currentSong,
      startAtMs,
      durationMs,
      preset,
      outputMode,
      events,
      logPlayback,
      seamless,
    );
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

  function handleMedleyModeToggle(next: boolean) {
    setMedleyMode(next);
    persistMedleyMode(next);
  }

  function handlePlaylistPlaybackModeChange(mode: PlaylistPlaybackMode) {
    setPlaylistPlaybackMode(mode);
    persistPlaylistPlaybackMode(mode);
  }

  function handlePlaylistAutoAdvanceToggle(next: boolean) {
    setPlaylistAutoAdvance(next);
    persistPlaylistAutoAdvance(next);
  }

  function handleThemePreferenceChange(preference: ThemePreference) {
    setThemePreference(preference);
    persistThemePreference(preference);
  }

  function handlePlaybackSpeedChange(value: string) {
    applyPlaybackSpeed(clampPlaybackSpeed(Number(value)));
  }

  function handlePlaybackSpeedStep(delta: number) {
    applyPlaybackSpeed(
      clampPlaybackSpeed(
        Math.round((selectedPreset.playback.speed + delta) * 100) / 100,
      ),
    );
  }

  function applyPlaybackSpeed(speed: number) {
    updateSelectedPreset((preset) => ({
      ...preset,
      playback: {
        ...preset.playback,
        speed,
      },
    }));

    if (playbackActive && songDurationMs > 0) {
      const positionMs = currentPlaybackPositionMs(songDurationMs);
      progressStartedAtRef.current = performance.now();
      progressOffsetMsRef.current = positionMs;
      progressSpeedRef.current = speed;
      setPlaybackPositionMs(positionMs);
    } else {
      progressSpeedRef.current = speed;
    }

    void invoke("set_playback_speed", { speed }).catch((error) => {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    });
  }

  function handlePlaybackDelayChange(
    field: "keyOutputDelayMs" | "auditionDelayMs",
    value: string,
  ) {
    const delayMs = clampInteger(value, selectedPreset.playback[field] ?? 0, 0, 5000);
    const nextPreset = {
      ...selectedPreset,
      playback: {
        ...selectedPreset.playback,
        [field]: delayMs,
      },
    };

    updateSelectedPreset((preset) => ({
      ...preset,
      playback: {
        ...preset.playback,
        [field]: delayMs,
      },
    }));

    void restartCurrentPlayback({ preset: nextPreset }).catch((error) => {
      stopProgress(false);
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    });
  }

  function handleScoreSelection(ids: string[]) {
    setScoreEditor((current) => setScoreSelection(current, ids));
  }

  function handleScoreShortcut(
    action: ScoreEditAction,
    visibleNoteIds: string[],
  ) {
    switch (action) {
      case "selectAll":
        setScoreEditor((current) => selectAllScoreNotes(current, visibleNoteIds));
        break;
      case "undo":
        setScoreEditor(undoScoreEdit);
        break;
      case "redo":
        setScoreEditor(redoScoreEdit);
        break;
      case "delete":
        setScoreEditor(deleteSelectedScoreNotes);
        break;
      case "copy":
        setScoreEditor(copySelectedScoreNotes);
        break;
      case "cut":
        setScoreEditor(cutSelectedScoreNotes);
        break;
      case "paste":
        setScoreEditor((current) =>
          pasteScoreClipboardAt(current, playbackPositionMs),
        );
        break;
      case "clearSelection":
        setScoreEditor(clearScoreSelection);
        break;
      case "nudgeLeft":
        setScoreEditor((current) => moveSelectedScoreNotes(current, -10));
        break;
      case "nudgeRight":
        setScoreEditor((current) => moveSelectedScoreNotes(current, 10));
        break;
      case "transposeUp":
        setScoreEditor((current) => transposeSelectedScoreNotes(current, 1));
        break;
      case "transposeDown":
        setScoreEditor((current) => transposeSelectedScoreNotes(current, -1));
        break;
    }
  }

  function handleTrackChange(trackKey: string, patch: Partial<TrackSummary>) {
    if (!TRACK_SWITCHING_ENABLED) {
      return;
    }

    const nextTracks = trackSummaries.map((track) =>
      track.key === trackKey ? { ...track, ...patch } : track,
    );
    setTrackSummaries(nextTracks);
    if (playbackActive) {
      void invoke("set_playback_tracks", {
        tracks: playbackTrackStatesFor(nextTracks),
      }).catch((error) => {
        pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
      });
    }
  }

  function handleToggleTrackHotkey(trackIndex: number) {
    if (!TRACK_SWITCHING_ENABLED) {
      return;
    }

    const track = trackSummaries[trackIndex];
    if (!track) {
      return;
    }

    handleTrackChange(track.key, {
      playbackEnabled: !track.playbackEnabled,
    });
  }

  function handleMoveSelectedScoreNotes(deltaMs: number) {
    if (deltaMs === 0 || scoreEditor.selectedNoteIds.length === 0) {
      return;
    }

    const selected = new Set(scoreEditor.selectedNoteIds);
    const selectedNotes = scoreEditor.notes.filter((note) => selected.has(note.id));
    setPreservedMidiEvents((current) =>
      moveNonNoteEventsWithSelectedNotes({
        deltaMs,
        events: current,
        selectedNotes,
      }),
    );
    setScoreEditor((current) => moveSelectedScoreNotes(current, deltaMs));
  }

  function handleScoreSeek(atMs: number) {
    const seekMs = clampPlaybackMs(atMs, songDurationMs);
    pendingSeekMsRef.current = null;
    setPendingSeekMs(null);
    setPlaybackPositionMs(seekMs);
  }

  async function handleOutputToggle(next: boolean) {
    setOutputEnabled(next);
    try {
      const enabled = await invoke<boolean>("set_output_enabled", {
        enabled: next,
      });
      setOutputEnabled(enabled);
      pushLog(enabled ? t("outputEnabledLog") : t("outputDisabledLog"));
      playbackOutputModeRef.current = playbackOutputModeForToggles({
        keyOutputEnabled: enabled,
        auditionEnabled,
      });
    } catch (error) {
      setOutputEnabled(false);
      pushLog(`${t("outputToggleFailed")}: ${readableError(error)}`);
    }
  }

  async function handleAuditionToggle(next: boolean) {
    setAuditionEnabled(next);
    persistAuditionEnabled(next);
    playbackOutputModeRef.current = playbackOutputModeForToggles({
      keyOutputEnabled: outputEnabled,
      auditionEnabled: next,
    });
    try {
      await invoke("set_audition_enabled", { enabled: next });
      pushLog(next ? t("auditionEnabledLog") : t("auditionDisabledLog"));
      if (next && audioOutputs.length === 0) {
        pushLog(t("noAudioOutputDeviceFound"));
      }
    } catch (error) {
      setAuditionEnabled(!next);
      persistAuditionEnabled(!next);
      playbackOutputModeRef.current = currentPlaybackOutputMode;
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
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

  function movePreset(direction: 1 | -1) {
    if (presets.length <= 1) {
      return;
    }

    const currentIndex = Math.max(
      0,
      presets.findIndex((preset) => preset.id === selectedPreset.id),
    );
    const nextIndex =
      (currentIndex + direction + presets.length) % presets.length;
    const preset = presets[nextIndex];
    if (!preset) {
      return;
    }

    setSelectedPresetId(preset.id);
    pushLog(`${t("presetSelected")}: ${preset.name}`);
  }

  function handleRecordHotkey(action: HotkeyAction) {
    if (!shouldExposeHotkey(action)) {
      return;
    }

    if (recordingAction === action) {
      setRecordingAction(null);
      pushLog(t("hotkeyRecordingCancelled"));
      return;
    }

    setRecordingAction(action);
    pushLog(`${t("hotkeyRecording")}: ${t(hotkeyActionLabels[action])}`);
  }

  function handleClearHotkey(action: HotkeyAction) {
    if (!shouldExposeHotkey(action)) {
      return;
    }

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

  function handlePassthroughHotkeysToggle(next: boolean) {
    persistPassthroughHotkeys(next);
    setPassthroughHotkeys(next);
    pushLog(next ? t("hotkeyPassthroughEnabled") : t("hotkeyExclusiveEnabled"));
  }

  function logHotkeyInstallResult(
    failed: { shortcut?: string; accelerator?: string; error: string }[],
  ) {
    if (failed.length === 0) {
      pushLog(
        passthroughHotkeys ? t("hotkeyPassthroughReady") : t("hotkeyRegistered"),
      );
      return;
    }

    const failedNames = failed
      .map((failure) => failure.shortcut ?? failure.accelerator ?? "")
      .filter(Boolean)
      .join(", ");
    pushLog(`${t("hotkeyPartiallyRegistered")}: ${failedNames}`);
  }

  function pushLog(message: string) {
    setLogs((current) => appendLogEntry(current, message));
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

        <div className="playlist-panel">
          <div className="playlist-panel-heading">
            <h2>{t("playlist")}</h2>
            <div className="playlist-controls">
              <div className="playlist-mode-control" aria-label={t("playlistMode")} role="group">
                {PLAYLIST_PLAYBACK_MODES.map((mode) => (
                  <button
                    className={mode === playlistPlaybackMode ? "active" : ""}
                    key={mode}
                    onClick={() => handlePlaylistPlaybackModeChange(mode)}
                    title={t(playlistPlaybackModeHintKey(mode))}
                    type="button"
                  >
                    {t(playlistPlaybackModeLabelKey(mode))}
                  </button>
                ))}
              </div>
              <label className="switch playlist-auto-advance" title={t("playlistAutoAdvanceHint")}>
                <input
                  checked={playlistAutoAdvance}
                  onChange={(event) =>
                    handlePlaylistAutoAdvanceToggle(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>{t("playlistAutoAdvance")}</span>
              </label>
            </div>
          </div>
          {playlist.length === 0 ? (
            <p>{t("playlistEmpty")}</p>
          ) : (
            <div className="playlist-list">
              {playlist.map((song, index) => (
                <button
                  className={`playlist-song${
                    index === currentSongIndex ? " active" : ""
                  }`}
                  key={song.path}
                  onClick={() => void handleSelectPlaylistSong(index)}
                  type="button"
                >
                  <span>{song.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
              <input
                max={4}
                min={0.1}
                onChange={(event) => handlePlaybackSpeedChange(event.target.value)}
                step={0.05}
                type="number"
                value={selectedPreset.playback.speed.toFixed(2)}
              />
            </label>
            <label>
              {t("transpose")}
              <input value={selectedPreset.playback.transpose} readOnly />
            </label>
            <label>
              {t("keyOutputDelay")}
              <input
                max={5000}
                min={0}
                onChange={(event) =>
                  handlePlaybackDelayChange(
                    "keyOutputDelayMs",
                    event.target.value,
                  )
                }
                step={1}
                type="number"
                value={selectedPreset.playback.keyOutputDelayMs ?? 0}
              />
            </label>
            <label>
              {t("auditionDelay")}
              <input
                max={5000}
                min={0}
                onChange={(event) =>
                  handlePlaybackDelayChange(
                    "auditionDelayMs",
                    event.target.value,
                  )
                }
                step={1}
                type="number"
                value={selectedPreset.playback.auditionDelayMs ?? 0}
              />
            </label>
          </div>

          <div className="tool-group playback-options">
            <label className="switch output-switch" title={t("outputSafety")}>
              <input
                checked={outputEnabled}
                onChange={(event) => void handleOutputToggle(event.target.checked)}
                type="checkbox"
              />
              <Keyboard size={15} />
              <span>{t("keyboardOutput")}</span>
            </label>
            <div className="audio-output-picker">
              <label className="switch output-switch" title={t("auditionOutputHint")}>
                <input
                  checked={auditionEnabled}
                  onChange={(event) => void handleAuditionToggle(event.target.checked)}
                  type="checkbox"
                />
                <Volume2 size={15} />
                <span>{t("auditionOutput")}</span>
              </label>
              <select
                aria-label={t("audioOutput")}
                disabled={audioOutputs.length === 0}
                onChange={(event) => void handleAudioOutputChange(event.target.value)}
                onFocus={() => void refreshAudioOutputs(true)}
                value={selectedAudioOutputValue(storedAudioOutput, audioOutputs)}
              >
                {audioOutputs.length === 0 ? (
                  <option value="">{t("noAudioOutputDeviceFound")}</option>
                ) : (
                  <>
                    <option value="">{t("systemDefaultAudioOutput")}</option>
                    {audioOutputs.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                        {device.isDefault ? ` (${t("systemDefaultAudioOutput")})` : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
            <label className="switch" title={t("medleyModeHint")}>
              <input
                checked={medleyMode}
                onChange={(event) => handleMedleyModeToggle(event.target.checked)}
                type="checkbox"
              />
              <span>{t("medleyMode")}</span>
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
            <label className="theme-switch">
              <Palette size={16} />
              <select
                aria-label={t("theme")}
                onChange={(event) =>
                  handleThemePreferenceChange(
                    event.target.value as ThemePreference,
                  )
                }
                value={themePreference}
              >
                <option value="system">{t("themeSystem")}</option>
                <option value="light">{t("themeLight")}</option>
                <option value="dark">{t("themeDark")}</option>
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
                void commitSeek(event.currentTarget.value);
              }
            }}
            onBlur={(event) => void commitSeek(event.currentTarget.value)}
            onMouseUp={(event) => void commitSeek(event.currentTarget.value)}
            onPointerUp={(event) => void commitSeek(event.currentTarget.value)}
            onTouchEnd={(event) => void commitSeek(event.currentTarget.value)}
            step={100}
            type="range"
            value={clampPlaybackMs(displayedPlaybackMs, songDurationMs)}
          />
          <span>{formatPlaybackTime(songDurationMs)}</span>
        </section>

        <section
          className={`content-grid${
            activeWorkspaceTab === "score" ? " score-focused" : ""
          }`}
        >
          <section className="rules-section">
            <div className="workspace-tabs" role="tablist">
              <button
                className={activeWorkspaceTab === "rules" ? "active" : ""}
                onClick={() => setActiveWorkspaceTab("rules")}
                role="tab"
                type="button"
              >
                {t("rules")}
              </button>
              <button
                className={activeWorkspaceTab === "score" ? "active" : ""}
                onClick={() => setActiveWorkspaceTab("score")}
                role="tab"
                type="button"
              >
                {t("score")}
              </button>
            </div>

            {activeWorkspaceTab === "rules" ? (
              <>
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
              </>
            ) : (
              <ScoreEditor
                durationMs={songDurationMs}
                notes={scoreEditor.notes}
                onCopySelected={() => setScoreEditor(copySelectedScoreNotes)}
                onCutSelected={() => setScoreEditor(cutSelectedScoreNotes)}
                onDeleteSelected={() => setScoreEditor(deleteSelectedScoreNotes)}
                onMoveSelected={handleMoveSelectedScoreNotes}
                onPasteAt={(atMs) =>
                  setScoreEditor((current) =>
                    pasteScoreClipboardAt(current, atMs),
                  )
                }
                onResizeSelected={(deltaMs) =>
                  setScoreEditor((current) =>
                    resizeSelectedScoreNotes(current, deltaMs),
                  )
                }
                onSeek={handleScoreSeek}
                onSelectNotes={handleScoreSelection}
                onShortcut={handleScoreShortcut}
                onTrackChange={handleTrackChange}
                onTransposeSelected={(deltaNotes) =>
                  setScoreEditor((current) =>
                    transposeSelectedScoreNotes(current, deltaNotes),
                  )
                }
                playbackPositionMs={displayedPlaybackMs}
                selectedNoteIds={scoreEditor.selectedNoteIds}
                t={t}
                trackSwitchingEnabled={TRACK_SWITCHING_ENABLED}
                tracks={trackSummaries}
              />
            )}
          </section>

          {activeWorkspaceTab === "rules" ? (
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
            <div className="output-toggle">
              <Volume2 size={18} />
              <div>
                <strong>
                  {auditionEnabled
                    ? t("auditionOutputEnabled")
                    : t("auditionOutputDisabled")}
                </strong>
                <span>{t("auditionOutputHint")}</span>
              </div>
              <div className="audio-output-picker">
                <label className="switch">
                  <input
                    checked={auditionEnabled}
                    onChange={(event) => void handleAuditionToggle(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("auditionOutput")}</span>
                </label>
                <select
                  aria-label={t("audioOutput")}
                  disabled={audioOutputs.length === 0}
                  onChange={(event) => void handleAudioOutputChange(event.target.value)}
                  onFocus={() => void refreshAudioOutputs(true)}
                  value={selectedAudioOutputValue(storedAudioOutput, audioOutputs)}
                >
                  {audioOutputs.length === 0 ? (
                    <option value="">{t("noAudioOutputDeviceFound")}</option>
                  ) : (
                    <>
                      <option value="">{t("systemDefaultAudioOutput")}</option>
                      {audioOutputs.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                          {device.isDefault ? ` (${t("systemDefaultAudioOutput")})` : ""}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            </div>

            <button className="command danger release-command" onClick={handleReleaseAll} type="button">
              <Save size={16} />
              <span>{t("releaseAllKeys")}</span>
            </button>

            <h2>{t("hotkeys")}</h2>
            <label className="switch hotkey-mode-switch" title={t("hotkeyPassthroughHint")}>
              <input
                checked={passthroughHotkeys}
                onChange={(event) =>
                  handlePassthroughHotkeysToggle(event.target.checked)
                }
                type="checkbox"
              />
              <span>{t("hotkeyPassthrough")}</span>
            </label>
            <div className="hotkey-list">
              {configurableHotkeys.map((binding) => {
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
          ) : null}
        </section>
      </section>
    </main>
  );
}

function loadInitialKeymap() {
  const storedKeymap = loadStoredKeymap();
  const presets = mergeBuiltInPresets(
    storedKeymap?.presets ?? fallbackBuiltInPresets(),
  );
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

function playlistPlaybackModeLabelKey(
  mode: PlaylistPlaybackMode,
): TranslationKey {
  return PLAYLIST_PLAYBACK_MODE_LABEL_KEYS[mode];
}

function playlistPlaybackModeHintKey(mode: PlaylistPlaybackMode): TranslationKey {
  return PLAYLIST_PLAYBACK_MODE_HINT_KEYS[mode];
}

function playbackTrackStatesFor(tracks: TrackSummary[]): PlaybackTrackState[] {
  const hasSolo = tracks.some((track) => track.solo);
  return tracks.map((track) => ({
    track: track.track,
    enabled:
      track.visible &&
      !track.muted &&
      track.playbackEnabled &&
      (!hasSolo || track.solo),
  }));
}

function loadStoredHotkeys(): HotkeyBinding[] {
  try {
    const saved = window.localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (saved) {
      const hotkeys = mergeSavedHotkeys(JSON.parse(saved));
      return validateHotkeyBindings(hotkeys).ok ? hotkeys : DEFAULT_HOTKEYS;
    }

    const legacy = window.localStorage.getItem(LEGACY_HOTKEY_STORAGE_KEY);
    const hotkeys = applyHotkeyV2Defaults(
      mergeSavedHotkeys(legacy ? JSON.parse(legacy) : null),
    );
    if (!validateHotkeyBindings(hotkeys).ok) {
      return DEFAULT_HOTKEYS;
    }
    window.localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(hotkeys));
    return hotkeys;
  } catch {
    return DEFAULT_HOTKEYS;
  }
}

function applyHotkeyV2Defaults(hotkeys: HotkeyBinding[]): HotkeyBinding[] {
  const v2DefaultActions = new Set<HotkeyAction>(["speedDown", "speedUp"]);
  const usedAccelerators = new Set(
    hotkeys
      .filter((binding) => binding.enabled && binding.accelerator)
      .map((binding) => normalizeAccelerator(binding.accelerator).toLowerCase()),
  );

  return hotkeys.map((binding) => {
    if (binding.enabled || binding.accelerator || !v2DefaultActions.has(binding.action)) {
      return binding;
    }

    const defaultBinding = DEFAULT_HOTKEYS.find(
      (item) => item.action === binding.action,
    );
    const defaultAccelerator = normalizeAccelerator(
      defaultBinding?.accelerator ?? "",
    ).toLowerCase();
    if (!defaultBinding || usedAccelerators.has(defaultAccelerator)) {
      return binding;
    }

    usedAccelerators.add(defaultAccelerator);
    return { ...defaultBinding };
  });
}

function loadStoredPassthroughHotkeys(): boolean {
  try {
    const stored = window.localStorage.getItem(HOTKEY_PASSTHROUGH_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function loadStoredAuditionEnabled(): boolean {
  try {
    return window.localStorage.getItem(AUDITION_OUTPUT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadStoredAudioOutput() {
  try {
    return parseStoredAudioOutput(
      window.localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY),
    );
  } catch {
    return parseStoredAudioOutput(null);
  }
}

function loadStoredThemePreference(): ThemePreference {
  try {
    return parseStoredThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function prefersDarkColorScheme(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  } catch {
    return false;
  }
}

function loadStoredMedleyMode(): boolean {
  try {
    return window.localStorage.getItem(MEDLEY_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function loadStoredPlaylistAutoAdvance(): boolean {
  try {
    const stored = window.localStorage.getItem(
      PLAYLIST_AUTO_ADVANCE_STORAGE_KEY,
    );
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function loadStoredPlaylistPlaybackMode(): PlaylistPlaybackMode {
  try {
    const stored = window.localStorage.getItem(
      PLAYLIST_PLAYBACK_MODE_STORAGE_KEY,
    );
    return isPlaylistPlaybackMode(stored) ? stored : "repeatAll";
  } catch {
    return "repeatAll";
  }
}

function persistThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistMedleyMode(enabled: boolean) {
  try {
    window.localStorage.setItem(MEDLEY_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistPlaylistPlaybackMode(mode: PlaylistPlaybackMode) {
  try {
    window.localStorage.setItem(PLAYLIST_PLAYBACK_MODE_STORAGE_KEY, mode);
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistPlaylistAutoAdvance(enabled: boolean) {
  try {
    window.localStorage.setItem(
      PLAYLIST_AUTO_ADVANCE_STORAGE_KEY,
      String(enabled),
    );
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistPassthroughHotkeys(enabled: boolean) {
  try {
    window.localStorage.setItem(HOTKEY_PASSTHROUGH_STORAGE_KEY, String(enabled));
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistAuditionEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(AUDITION_OUTPUT_STORAGE_KEY, String(enabled));
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function persistHotkeys(hotkeys: HotkeyBinding[]) {
  try {
    window.localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(hotkeys));
  } catch {
    // Local storage is best-effort; the in-memory setting still applies.
  }
}

function isHotkeyAction(action: unknown): action is HotkeyAction {
  return (
    typeof action === "string" && HOTKEY_ACTIONS.includes(action as HotkeyAction)
  );
}

function shouldExposeHotkey(action: HotkeyAction): boolean {
  return TRACK_SWITCHING_ENABLED || !isTrackToggleAction(action);
}

function isTrackToggleAction(action: HotkeyAction): boolean {
  return /^toggleTrack[1-9]$/.test(action);
}

function isPlaylistPlaybackMode(value: unknown): value is PlaylistPlaybackMode {
  return (
    typeof value === "string" &&
    PLAYLIST_PLAYBACK_MODES.includes(value as PlaylistPlaybackMode)
  );
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

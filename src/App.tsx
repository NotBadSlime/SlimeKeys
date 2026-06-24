import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
  Square,
  Trash2,
} from "lucide-react";
import type { AppSnapshot, MidiEvent, MidiInputDevice, Preset } from "./types";
import {
  createTranslator,
  defaultLanguage,
  detectLanguage,
  type Language,
} from "./lib/i18n";
import {
  eventTypeLabel,
  fallbackGenshinPreset,
  formatNoteFilter,
  summarizePreset,
  triggerModeLabel,
} from "./lib/presets";

function App() {
  const [language, setLanguage] = useState<Language>(() =>
    typeof navigator === "undefined"
      ? defaultLanguage
      : detectLanguage(navigator.language),
  );
  const [presets, setPresets] = useState<Preset[]>([fallbackGenshinPreset()]);
  const [selectedPresetId, setSelectedPresetId] = useState("genshin-21-key");
  const [midiInputs, setMidiInputs] = useState<MidiInputDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [outputEnabled, setOutputEnabled] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [openedPath, setOpenedPath] = useState("");
  const [openedFile, setOpenedFile] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
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

  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];
  const summary = useMemo(
    () => summarizePreset(selectedPreset),
    [selectedPreset],
  );

  async function loadBackendState() {
    try {
      const snapshot = await invoke<AppSnapshot>("get_app_snapshot");
      setPresets(snapshot.presets);
      setSelectedPresetId(snapshot.presets[0]?.id ?? "genshin-21-key");
      setOutputEnabled(snapshot.outputEnabled);
      pushLog(t("backendConnected"));
    } catch {
      pushLog(t("previewMode"));
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
        multiple: false,
        filters: [{ name: "MIDI", extensions: ["mid", "midi"] }],
      });
      if (typeof selected !== "string") {
        return;
      }

      setOpenedPath(selected);
      setOpenedFile(fileName(selected));
      const events = await invoke<MidiEvent[]>("parse_midi_file", {
        path: selected,
      });
      pushLog(`${t("parsedMidiEvents")}: ${events.length} (${fileName(selected)})`);
    } catch (error) {
      pushLog(`${t("openMidiFailed")}: ${readableError(error)}`);
    }
  }

  async function handlePlay() {
    if (!openedPath) {
      pushLog(t("openBeforePlayback"));
      return;
    }

    try {
      const actionCount = await invoke<number>("play_midi_file", {
        path: openedPath,
      });
      pushLog(`${t("playbackStarted")}: ${actionCount}`);
    } catch (error) {
      pushLog(`${t("playbackFailed")}: ${readableError(error)}`);
    }
  }

  async function handleStop() {
    try {
      await invoke("stop_playback");
      pushLog(t("playbackStopped"));
    } catch (error) {
      pushLog(`${t("stopFailed")}: ${readableError(error)}`);
    }
  }

  async function handleLiveToggle(next: boolean) {
    if (next && selectedInputId === "") {
      pushLog(t("selectMidiBeforeLive"));
      return;
    }

    setLiveEnabled(next);
    try {
      if (next) {
        await invoke("start_live_input", {
          deviceId: Number(selectedInputId),
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
          <button title="New preset" type="button">
            <Plus size={16} />
          </button>
          <button title={t("importPreset")} type="button">
            <Import size={16} />
          </button>
          <button title={t("exportPreset")} type="button">
            <Download size={16} />
          </button>
          <button title="Delete preset" type="button">
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
            <button className="icon-command" onClick={handlePlay} title={t("play")} type="button">
              <Play size={16} />
            </button>
            <button className="icon-command" disabled title={t("pause")} type="button">
              <Pause size={16} />
            </button>
            <button className="icon-command" onClick={handleStop} title={t("stop")} type="button">
              <Square size={16} />
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

        <section className="status-line">
          <span>{openedFile}</span>
          <span>{summary.enabledRules} enabled rules</span>
          <span>{summary.triggerModes.map(triggerModeLabel).join(", ")}</span>
        </section>

        <section className="content-grid">
          <section className="rules-section">
            <div className="section-heading">
              <div>
                <h2>{t("rules")}</h2>
                <p>{t("triggerHint")}</p>
              </div>
              <button className="command" type="button">
                <Plus size={16} />
                <span>{t("addRule")}</span>
              </button>
            </div>

            <div className="rule-table" role="table" aria-label="Rule table">
              <div className="rule-row header" role="row">
                <span>On</span>
                <span>Name</span>
                <span>Event</span>
                <span>Source</span>
                <span>Keys</span>
                <span>Mode</span>
                <span>Press</span>
              </div>
              {selectedPreset.rules.map((rule) => (
                <div className="rule-row" role="row" key={rule.id}>
                  <span>
                    <input type="checkbox" checked={rule.enabled} readOnly />
                  </span>
                  <span title={formatNoteFilter(rule.note)}>{rule.name}</span>
                  <span>{eventTypeLabel(rule.eventType)}</span>
                  <span>{rule.inputSource}</span>
                  <span>{rule.output.keys.join(" + ")}</span>
                  <span>
                    <span className={`mode-badge ${rule.triggerMode}`}>
                      {triggerModeLabel(rule.triggerMode)}
                    </span>
                  </span>
                  <span>{rule.pressDurationMs} ms</span>
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

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;

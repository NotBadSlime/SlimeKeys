import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FileMusic,
  FolderOpen,
  Import,
  Keyboard,
  Pause,
  Play,
  Plus,
  RadioTower,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import type { AppSnapshot, MidiEvent, MidiInputDevice, Preset } from "./types";
import {
  eventTypeLabel,
  fallbackGenshinPreset,
  formatNoteFilter,
  summarizePreset,
  triggerModeLabel,
} from "./lib/presets";

function App() {
  const [presets, setPresets] = useState<Preset[]>([fallbackGenshinPreset()]);
  const [selectedPresetId, setSelectedPresetId] = useState("genshin-21-key");
  const [midiInputs, setMidiInputs] = useState<MidiInputDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [outputEnabled, setOutputEnabled] = useState(false);
  const [openedFile, setOpenedFile] = useState<string>("No MIDI file selected");
  const [logs, setLogs] = useState<string[]>([
    "Ready. Open a MIDI file or select a live input device.",
    "Default preset uses Tap mode for game instruments.",
  ]);

  useEffect(() => {
    void loadBackendState();
  }, []);

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
      pushLog("Backend connected.");
    } catch {
      pushLog("Running in preview mode without Tauri backend.");
    }

    try {
      const devices = await invoke<MidiInputDevice[]>("list_midi_inputs");
      setMidiInputs(devices);
      if (devices[0]) {
        setSelectedInputId(String(devices[0].id));
      }
    } catch {
      setMidiInputs([]);
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

      setOpenedFile(fileName(selected));
      const events = await invoke<MidiEvent[]>("parse_midi_file", {
        path: selected,
      });
      pushLog(`Parsed ${events.length} MIDI note events from ${fileName(selected)}.`);
    } catch (error) {
      pushLog(`Open MIDI failed: ${readableError(error)}`);
    }
  }

  async function handleOutputToggle(next: boolean) {
    setOutputEnabled(next);
    try {
      const enabled = await invoke<boolean>("set_output_enabled", {
        enabled: next,
      });
      setOutputEnabled(enabled);
      pushLog(enabled ? "Keyboard output enabled." : "Keyboard output disabled.");
    } catch (error) {
      setOutputEnabled(false);
      pushLog(`Output toggle failed: ${readableError(error)}`);
    }
  }

  async function handleReleaseAll() {
    try {
      await invoke("panic_release_all_keys");
      pushLog("Released all keys tracked by SlimeKeys.");
    } catch (error) {
      pushLog(`Release failed: ${readableError(error)}`);
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
          <button title="Import preset" type="button">
            <Import size={16} />
          </button>
          <button title="Export preset" type="button">
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
              <span>Open MIDI</span>
            </button>
            <button className="icon-command" title="Play" type="button">
              <Play size={16} />
            </button>
            <button className="icon-command" title="Pause" type="button">
              <Pause size={16} />
            </button>
            <button className="icon-command" title="Stop" type="button">
              <Square size={16} />
            </button>
          </div>

          <div className="tool-group settings">
            <label>
              Speed
              <input value={selectedPreset.playback.speed.toFixed(2)} readOnly />
            </label>
            <label>
              Transpose
              <input value={selectedPreset.playback.transpose} readOnly />
            </label>
            <label>
              Delay
              <input value={`${selectedPreset.playback.globalDelayMs} ms`} readOnly />
            </label>
          </div>

          <div className="tool-group live-input">
            <RadioTower size={16} />
            <select
              aria-label="MIDI input device"
              onChange={(event) => setSelectedInputId(event.target.value)}
              value={selectedInputId}
            >
              {midiInputs.length === 0 ? (
                <option value="">No MIDI device found</option>
              ) : (
                midiInputs.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))
              )}
            </select>
            <label className="switch">
              <input type="checkbox" />
              <span>Live</span>
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
                <h2>Rules</h2>
                <p>
                  If repeated notes sound like one long press, use Tap or
                  Retrigger. Start with an 8-20 ms release gap.
                </p>
              </div>
              <button className="command" type="button">
                <Plus size={16} />
                <span>Add Rule</span>
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
            <h2>Output</h2>
            <div className="output-toggle">
              <Keyboard size={18} />
              <div>
                <strong>
                  {outputEnabled ? "Key output enabled" : "Key output disabled"}
                </strong>
                <span>Enable only when the target game is foreground.</span>
              </div>
              <label className="switch">
                <input
                  checked={outputEnabled}
                  onChange={(event) => void handleOutputToggle(event.target.checked)}
                  type="checkbox"
                />
                <span>Output</span>
              </label>
            </div>

            <button className="command danger release-command" onClick={handleReleaseAll} type="button">
              <Save size={16} />
              <span>Release All Keys</span>
            </button>

            <h2>Recent Events</h2>
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

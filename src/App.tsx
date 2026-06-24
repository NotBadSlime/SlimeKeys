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

const demoRules = [
  ["C3", "Note On", "All", "Z", "Tap", "35 ms"],
  ["D3", "Note On", "All", "X", "Tap", "35 ms"],
  ["E3", "Note On", "All", "C", "Tap", "35 ms"],
  ["F3", "Note On", "All", "V", "Tap", "35 ms"],
  ["G3", "Note On", "All", "B", "Tap", "35 ms"],
  ["A3", "Note On", "All", "N", "Tap", "35 ms"],
  ["B3", "Note On", "All", "M", "Tap", "35 ms"],
];

function App() {
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

        <button className="preset active" type="button">
          <span>Genshin 21-Key</span>
          <small>21 enabled rules</small>
        </button>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div className="tool-group">
            <button className="command primary" type="button">
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
              <input defaultValue="1.00" inputMode="decimal" />
            </label>
            <label>
              Transpose
              <input defaultValue="0" inputMode="numeric" />
            </label>
            <label>
              Delay
              <input defaultValue="0 ms" />
            </label>
          </div>

          <div className="tool-group live-input">
            <RadioTower size={16} />
            <select aria-label="MIDI input device">
              <option>No MIDI device selected</option>
            </select>
            <label className="switch">
              <input type="checkbox" />
              <span>Live</span>
            </label>
          </div>
        </header>

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
              {demoRules.map((rule) => (
                <div className="rule-row" role="row" key={rule[0]}>
                  <span>
                    <input type="checkbox" defaultChecked />
                  </span>
                  {rule.map((cell) => (
                    <span key={cell}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="inspector">
            <h2>Output</h2>
            <div className="output-toggle">
              <Keyboard size={18} />
              <div>
                <strong>Key output disabled</strong>
                <span>Enable only when the target game is foreground.</span>
              </div>
              <button className="command danger" type="button">
                <Save size={16} />
                <span>Release</span>
              </button>
            </div>

            <h2>Recent Events</h2>
            <div className="log-list">
              <p>
                <FileMusic size={14} /> Ready. Open a MIDI file or select a live
                input device.
              </p>
              <p>
                <Keyboard size={14} /> Default preset uses Tap mode for game
                instruments.
              </p>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

export default App;

import { describe, expect, it } from "vitest";
import {
  acceleratorFromKeyboardEvent,
  captureHotkeyFromKeyboardEvent,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  mergeSavedHotkeys,
  normalizeAccelerator,
  shouldHandleShortcutEvent,
  validateHotkeyBindings,
} from "./hotkeys";

describe("hotkey helpers", () => {
  it("defines defaults for all playback hotkey actions", () => {
    expect(HOTKEY_ACTIONS).toEqual([
      "play",
      "stop",
      "next",
      "previous",
      "releaseAll",
    ]);
    expect(DEFAULT_HOTKEYS.map((binding) => binding.action)).toEqual(
      HOTKEY_ACTIONS,
    );
    expect(DEFAULT_HOTKEYS.every((binding) => binding.enabled)).toBe(true);
  });

  it("normalizes common accelerator aliases", () => {
    expect(normalizeAccelerator("ctrl + alt + right")).toBe("Ctrl+Alt+Right");
    expect(normalizeAccelerator("Control+Option+Backspace")).toBe(
      "Ctrl+Alt+Backspace",
    );
    expect(normalizeAccelerator("Control+Alt+KeyP")).toBe("Ctrl+Alt+P");
    expect(normalizeAccelerator("Control+Alt+Digit1")).toBe("Ctrl+Alt+1");
    expect(normalizeAccelerator("control+alt+ArrowRight")).toBe(
      "Ctrl+Alt+Right",
    );
  });

  it("rejects duplicate enabled shortcuts", () => {
    const result = validateHotkeyBindings([
      { action: "play", accelerator: "Ctrl+Alt+P", enabled: true },
      { action: "stop", accelerator: "ctrl + alt + p", enabled: true },
    ]);

    expect(result).toEqual({ ok: false, error: "duplicate" });
  });

  it("merges saved bindings with defaults and ignores unknown actions", () => {
    const merged = mergeSavedHotkeys([
      { action: "play", accelerator: "Ctrl+Shift+P", enabled: false },
      { action: "unknown", accelerator: "Ctrl+Alt+U", enabled: true },
    ]);

    expect(merged).toHaveLength(DEFAULT_HOTKEYS.length);
    expect(merged.find((binding) => binding.action === "play")).toEqual({
      action: "play",
      accelerator: "Ctrl+Shift+P",
      enabled: false,
    });
    expect(merged.map((binding) => binding.action)).not.toContain("unknown");
  });

  it("keeps cleared disabled bindings when loading saved settings", () => {
    const merged = mergeSavedHotkeys([
      { action: "next", accelerator: "", enabled: false },
    ]);

    expect(merged.find((binding) => binding.action === "next")).toEqual({
      action: "next",
      accelerator: "",
      enabled: false,
    });
  });

  it("builds accelerators from keyboard events", () => {
    const event = {
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      key: "ArrowRight",
    } as KeyboardEvent;

    expect(acceleratorFromKeyboardEvent(event)).toBe("Ctrl+Alt+Right");
  });

  it("keeps recording open while only a modifier key is pressed", () => {
    expect(
      captureHotkeyFromKeyboardEvent({
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        key: "Control",
      } as KeyboardEvent),
    ).toEqual({ kind: "pending" });
  });

  it("captures only modifier-based shortcut combinations", () => {
    expect(
      captureHotkeyFromKeyboardEvent({
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        key: "P",
      } as KeyboardEvent),
    ).toEqual({ kind: "invalid" });

    expect(
      captureHotkeyFromKeyboardEvent({
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
        key: "P",
      } as KeyboardEvent),
    ).toEqual({ kind: "record", accelerator: "Ctrl+Alt+P" });
  });

  it("supports cancel and clear keys while recording hotkeys", () => {
    expect(
      captureHotkeyFromKeyboardEvent({
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        key: "Escape",
      } as KeyboardEvent),
    ).toEqual({ kind: "cancel" });

    expect(
      captureHotkeyFromKeyboardEvent({
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        key: "Backspace",
      } as KeyboardEvent),
    ).toEqual({ kind: "clear" });
  });

  it("runs global hotkey actions after the shortcut key is released", () => {
    expect(shouldHandleShortcutEvent("Pressed")).toBe(false);
    expect(shouldHandleShortcutEvent("Released")).toBe(true);
  });
});

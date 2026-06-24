import type { HotkeyAction, HotkeyBinding } from "../types";

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  "play",
  "stop",
  "next",
  "previous",
  "releaseAll",
];

export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  { action: "play", accelerator: "Ctrl+Alt+P", enabled: true },
  { action: "stop", accelerator: "Ctrl+Alt+S", enabled: true },
  { action: "next", accelerator: "Ctrl+Alt+Right", enabled: true },
  { action: "previous", accelerator: "Ctrl+Alt+Left", enabled: true },
  { action: "releaseAll", accelerator: "Ctrl+Alt+Backspace", enabled: true },
];

type SavedHotkeyBinding = {
  action?: unknown;
  accelerator?: unknown;
  enabled?: unknown;
};

export type HotkeyValidationResult =
  | { ok: true }
  | { ok: false; error: "empty" | "duplicate" };

export function normalizeAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => normalizeAcceleratorPart(part.trim()))
    .filter(Boolean)
    .join("+");
}

export function acceleratorFromKeyboardEvent(event: KeyboardEvent): string {
  const key = normalizeEventKey(event.key);
  if (!key) {
    return "";
  }

  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Command" : "",
    key,
  ].filter(Boolean);

  return normalizeAccelerator(parts.join("+"));
}

export function validateHotkeyBindings(
  bindings: (Pick<HotkeyBinding, "accelerator" | "enabled"> & {
    action?: unknown;
  })[],
): HotkeyValidationResult {
  const seen = new Set<string>();

  for (const binding of bindings) {
    if (!binding.enabled) {
      continue;
    }

    const accelerator = normalizeAccelerator(binding.accelerator);
    if (!accelerator) {
      return { ok: false, error: "empty" };
    }

    const key = accelerator.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: "duplicate" };
    }
    seen.add(key);
  }

  return { ok: true };
}

export function mergeSavedHotkeys(saved: unknown): HotkeyBinding[] {
  if (!Array.isArray(saved)) {
    return cloneDefaults();
  }

  const byAction = new Map<HotkeyAction, HotkeyBinding>();
  for (const binding of saved) {
    if (!isSavedHotkeyBinding(binding) || !isHotkeyAction(binding.action)) {
      continue;
    }

    byAction.set(binding.action, {
      action: binding.action,
      accelerator:
        typeof binding.accelerator === "string"
          ? normalizeAccelerator(binding.accelerator)
          : "",
      enabled: typeof binding.enabled === "boolean" ? binding.enabled : true,
    });
  }

  return DEFAULT_HOTKEYS.map((defaultBinding) => {
    const savedBinding = byAction.get(defaultBinding.action);
    if (!savedBinding) {
      return { ...defaultBinding };
    }

    return savedBinding.accelerator || !savedBinding.enabled
      ? savedBinding
      : { ...defaultBinding };
  });
}

function cloneDefaults(): HotkeyBinding[] {
  return DEFAULT_HOTKEYS.map((binding) => ({ ...binding }));
}

function isHotkeyAction(action: unknown): action is HotkeyAction {
  return (
    typeof action === "string" &&
    HOTKEY_ACTIONS.includes(action as HotkeyAction)
  );
}

function isSavedHotkeyBinding(value: unknown): value is SavedHotkeyBinding {
  return typeof value === "object" && value !== null;
}

function normalizeAcceleratorPart(part: string): string {
  const lower = part.toLowerCase();
  const aliases: Record<string, string> = {
    alt: "Alt",
    option: "Alt",
    control: "Ctrl",
    ctrl: "Ctrl",
    shift: "Shift",
    command: "Command",
    cmd: "Command",
    meta: "Command",
    left: "Left",
    right: "Right",
    up: "Up",
    down: "Down",
    backspace: "Backspace",
    space: "Space",
    esc: "Esc",
    escape: "Esc",
  };

  return aliases[lower] ?? normalizeKeyName(part);
}

function normalizeEventKey(key: string): string {
  const aliases: Record<string, string> = {
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    " ": "Space",
  };
  const normalized = aliases[key] ?? key;
  const lower = normalized.toLowerCase();

  if (["control", "ctrl", "alt", "shift", "meta"].includes(lower)) {
    return "";
  }

  return normalized;
}

function normalizeKeyName(part: string): string {
  if (part.length === 1) {
    return part.toUpperCase();
  }

  return part.slice(0, 1).toUpperCase() + part.slice(1);
}

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORED_AUDIO_OUTPUT,
  effectiveAudioOutputId,
  parseStoredAudioOutput,
  selectedAudioOutputValue,
  storedAudioOutputFromSelection,
} from "./audioOutput";
import type { AudioOutputDevice } from "../types";

const devices: AudioOutputDevice[] = [
  { id: "default-id", name: "Speakers", isDefault: true },
  { id: "headphones-id", name: "Headphones", isDefault: false },
];

describe("audio output preference", () => {
  it("defaults to follow-system-default", () => {
    expect(parseStoredAudioOutput(null)).toEqual(DEFAULT_STORED_AUDIO_OUTPUT);
    expect(parseStoredAudioOutput("nope")).toEqual(DEFAULT_STORED_AUDIO_OUTPUT);
  });

  it("round-trips a concrete device id", () => {
    const stored = parseStoredAudioOutput(
      JSON.stringify({
        followSystemDefault: false,
        deviceId: "headphones-id",
      }),
    );
    expect(stored).toEqual({
      followSystemDefault: false,
      deviceId: "headphones-id",
    });
    expect(effectiveAudioOutputId(stored, devices)).toBe("headphones-id");
    expect(selectedAudioOutputValue(stored, devices)).toBe("headphones-id");
  });

  it("falls back to system default when the saved id is missing without changing the stored value", () => {
    const stored = {
      followSystemDefault: false,
      deviceId: "missing-id",
    };
    expect(effectiveAudioOutputId(stored, devices)).toBeNull();
    expect(selectedAudioOutputValue(stored, devices)).toBe("");
    expect(stored.deviceId).toBe("missing-id");
  });

  it("reselects a saved id when it reappears in the list", () => {
    const stored = {
      followSystemDefault: false,
      deviceId: "headphones-id",
    };
    expect(effectiveAudioOutputId(stored, [])).toBeNull();
    expect(effectiveAudioOutputId(stored, devices)).toBe("headphones-id");
  });

  it("treats an empty dropdown value as follow-system-default", () => {
    expect(storedAudioOutputFromSelection("")).toEqual({
      followSystemDefault: true,
      deviceId: null,
    });
    expect(storedAudioOutputFromSelection("headphones-id")).toEqual({
      followSystemDefault: false,
      deviceId: "headphones-id",
    });
  });
});

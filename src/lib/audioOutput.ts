import type { AudioOutputDevice, StoredAudioOutput } from "../types";

export const AUDIO_OUTPUT_STORAGE_KEY = "slimekeys.audioOutput.v1";

export const DEFAULT_STORED_AUDIO_OUTPUT: StoredAudioOutput = {
  followSystemDefault: true,
  deviceId: null,
};

export function parseStoredAudioOutput(raw: string | null): StoredAudioOutput {
  if (!raw) {
    return DEFAULT_STORED_AUDIO_OUTPUT;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAudioOutput>;
    if (typeof parsed.followSystemDefault !== "boolean") {
      return DEFAULT_STORED_AUDIO_OUTPUT;
    }
    if (
      parsed.deviceId !== null &&
      parsed.deviceId !== undefined &&
      typeof parsed.deviceId !== "string"
    ) {
      return DEFAULT_STORED_AUDIO_OUTPUT;
    }
    return {
      followSystemDefault: parsed.followSystemDefault,
      deviceId: parsed.deviceId ?? null,
    };
  } catch {
    return DEFAULT_STORED_AUDIO_OUTPUT;
  }
}

export function effectiveAudioOutputId(
  stored: StoredAudioOutput,
  devices: AudioOutputDevice[],
): string | null {
  if (stored.followSystemDefault || !stored.deviceId) {
    return null;
  }
  return devices.some((device) => device.id === stored.deviceId)
    ? stored.deviceId
    : null;
}

export function selectedAudioOutputValue(
  stored: StoredAudioOutput,
  devices: AudioOutputDevice[],
): string {
  return effectiveAudioOutputId(stored, devices) ?? "";
}

export function storedAudioOutputFromSelection(
  value: string,
): StoredAudioOutput {
  if (!value) {
    return { followSystemDefault: true, deviceId: null };
  }
  return { followSystemDefault: false, deviceId: value };
}

import type { MidiEvent } from "../types";

export function midiDurationMs(events: MidiEvent[]): number {
  return events.reduce((duration, event) => Math.max(duration, event.atMs), 0);
}

export function clampPlaybackMs(value: number, durationMs: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), Math.max(durationMs, 0));
}

export function playbackStartMs(positionMs: number, durationMs: number): number {
  const position = clampPlaybackMs(positionMs, durationMs);
  return position > 0 && position < durationMs ? position : 0;
}

export function formatPlaybackTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(ms, 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

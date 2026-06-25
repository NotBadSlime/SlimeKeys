import { describe, expect, it } from "vitest";
import { formatPlaybackTime, midiDurationMs } from "./playbackProgress";
import type { MidiEvent } from "../types";

describe("playbackProgress", () => {
  it("uses the latest MIDI event as the song duration", () => {
    const events: MidiEvent[] = [
      eventAt(0),
      eventAt(1250),
      eventAt(62000),
    ];

    expect(midiDurationMs(events)).toBe(62000);
  });

  it("formats elapsed playback time", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(65_400)).toBe("1:05");
  });
});

function eventAt(atMs: number): MidiEvent {
  return {
    inputSource: "file",
    eventType: "noteOn",
    track: 0,
    channel: 1,
    note: 60,
    velocity: 90,
    atMs,
  };
}

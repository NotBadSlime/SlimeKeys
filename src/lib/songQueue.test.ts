import { describe, expect, it } from "vitest";
import {
  isMidiPath,
  selectRelativeSong,
  songEntryFromPath,
} from "./songQueue";

describe("song queue helpers", () => {
  it("wraps playlist next from the last song to the first", () => {
    const playlist = [
      songEntryFromPath("C:/songs/a.mid"),
      songEntryFromPath("C:/songs/b.mid"),
      songEntryFromPath("C:/songs/c.mid"),
    ];

    const selected = selectRelativeSong({
      currentPath: "C:/songs/c.mid",
      direction: 1,
      playlist,
      folderSongs: [],
    });

    expect(selected?.path).toBe("C:/songs/a.mid");
  });

  it("wraps playlist previous from the first song to the last", () => {
    const playlist = [
      songEntryFromPath("C:/songs/a.mid"),
      songEntryFromPath("C:/songs/b.mid"),
      songEntryFromPath("C:/songs/c.mid"),
    ];

    const selected = selectRelativeSong({
      currentPath: "C:/songs/a.mid",
      direction: -1,
      playlist,
      folderSongs: [],
    });

    expect(selected?.path).toBe("C:/songs/c.mid");
  });

  it("uses sorted folder songs when no playlist is available", () => {
    const selected = selectRelativeSong({
      currentPath: "C:/songs/b.mid",
      direction: 1,
      playlist: [songEntryFromPath("C:/songs/b.mid")],
      folderSongs: [
        "C:/songs/c.midi",
        "C:/songs/a.mid",
        "C:/songs/b.mid",
      ].map(songEntryFromPath),
    });

    expect(selected?.path).toBe("C:/songs/c.midi");
  });

  it("returns null when there is no current song", () => {
    const selected = selectRelativeSong({
      currentPath: "",
      direction: 1,
      playlist: [],
      folderSongs: [],
    });

    expect(selected).toBeNull();
  });

  it("recognizes midi file extensions case-insensitively", () => {
    expect(isMidiPath("C:/songs/theme.MID")).toBe(true);
    expect(isMidiPath("C:/songs/theme.midi")).toBe(true);
    expect(isMidiPath("C:/songs/theme.mp3")).toBe(false);
  });
});

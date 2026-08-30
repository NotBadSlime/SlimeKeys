import type { SongEntry } from "../types";

export interface RelativeSongArgs {
  currentPath: string;
  direction: 1 | -1;
  playlist: SongEntry[];
  folderSongs: SongEntry[];
}

export function songEntryFromPath(path: string): SongEntry {
  return {
    path,
    name: fileName(path),
  };
}

export function selectRelativeSong({
  currentPath,
  direction,
  playlist,
  folderSongs,
}: RelativeSongArgs): SongEntry | null {
  if (!currentPath) {
    return null;
  }

  const source = playlist.length > 1 ? playlist : sortedSongs(folderSongs);
  if (source.length === 0) {
    return null;
  }

  const currentIndex = source.findIndex(
    (song) => normalizePath(song.path) === normalizePath(currentPath),
  );
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = wrapIndex(baseIndex + direction, source.length);

  return source[nextIndex] ?? null;
}

export function isMidiPath(path: string): boolean {
  return /\.(mid|midi)$/i.test(path);
}

function sortedSongs(songs: SongEntry[]): SongEntry[] {
  return [...songs].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

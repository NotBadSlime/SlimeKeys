import { describe, expect, it } from "vitest";
import { createTranslator } from "./i18n";

describe("createTranslator", () => {
  it("uses the selected language text", () => {
    const t = createTranslator("zh");

    expect(t("openMidi")).toBe("打开 MIDI");
  });

  it("falls back to English when a key is missing", () => {
    const t = createTranslator("zh", { zh: { openMidi: "" } });

    expect(t("openMidi")).toBe("Open MIDI");
  });
});

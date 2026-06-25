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

  it("labels devices that are detected but not live-capable", () => {
    const t = createTranslator("zh");

    expect(t("detectedOnly")).toBe("仅识别");
  });

  it("explains that loopMIDI needs an actual created port", () => {
    const t = createTranslator("zh");

    expect(t("midiDevicesNotFound")).toContain("上方列表");
    expect(t("midiDevicesNotFound")).toContain("New port-name");
  });
});

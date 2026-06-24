export const languages = ["zh", "en"] as const;

export type Language = (typeof languages)[number];

export const defaultLanguage: Language = "zh";

export const translations = {
  en: {
    addRule: "Add Rule",
    backendConnected: "Backend connected.",
    defaultPresetTap: "Default preset uses Tap mode for game instruments.",
    delay: "Delay",
    exportPreset: "Export preset",
    importPreset: "Import preset",
    keyOutputDisabled: "Key output disabled",
    keyOutputEnabled: "Key output enabled",
    language: "Language",
    live: "Live",
    liveInputDisabled: "Live MIDI input disabled and held keys released.",
    liveInputEnabled: "Live MIDI input enabled.",
    midiInput: "MIDI input",
    noMidiDeviceFound: "No MIDI device found",
    noMidiFile: "No MIDI file selected",
    openBeforePlayback: "Open a MIDI file before playback.",
    openMidi: "Open MIDI",
    outputDisabledLog: "Keyboard output disabled.",
    outputEnabledLog: "Keyboard output enabled.",
    outputToggleFailed: "Output toggle failed",
    output: "Output",
    outputSafety: "Enable only when the target game is foreground.",
    pause: "Pause",
    play: "Play",
    playbackFailed: "Playback failed",
    playbackStarted: "Playback started",
    playbackStopped: "Playback stopped and held keys released.",
    previewMode: "Running in preview mode without Tauri backend.",
    recentEvents: "Recent Events",
    refreshMidi: "Refresh MIDI devices",
    releaseFailed: "Release failed",
    releaseAllKeys: "Release All Keys",
    releasedKeys: "Released all keys tracked by SlimeKeys.",
    rules: "Rules",
    ready: "Ready. Open a MIDI file or select a live input device.",
    selectMidiBeforeLive: "Select a MIDI input device before enabling live input.",
    speed: "Speed",
    stop: "Stop",
    stopFailed: "Stop failed",
    transpose: "Transpose",
    triggerHint:
      "If repeated notes sound like one long press, use Tap or Retrigger. Start with an 8-20 ms release gap.",
    liveFailed: "Live input failed",
    midiDevicesFound: "MIDI devices found",
    midiDevicesNotFound: "No MIDI input devices found. Start loopMIDI, create a port, then refresh.",
    midiDevicesRefreshFailed: "MIDI device refresh failed",
    openMidiFailed: "Open MIDI failed",
    parsedMidiEvents: "Parsed MIDI note events",
  },
  zh: {
    addRule: "添加规则",
    backendConnected: "后端已连接。",
    defaultPresetTap: "默认预设使用 Tap 点击模式，适合游戏乐器。",
    delay: "延迟",
    exportPreset: "导出预设",
    importPreset: "导入预设",
    keyOutputDisabled: "键盘输出已关闭",
    keyOutputEnabled: "键盘输出已开启",
    language: "语言",
    live: "实时",
    liveInputDisabled: "实时 MIDI 已关闭，并已释放按键。",
    liveInputEnabled: "实时 MIDI 已开启。",
    midiInput: "MIDI 输入",
    noMidiDeviceFound: "未发现 MIDI 设备",
    noMidiFile: "未选择 MIDI 文件",
    openBeforePlayback: "请先打开 MIDI 文件再播放。",
    openMidi: "打开 MIDI",
    outputDisabledLog: "键盘输出已关闭。",
    outputEnabledLog: "键盘输出已开启。",
    outputToggleFailed: "切换输出失败",
    output: "输出",
    outputSafety: "只在目标游戏位于前台时开启。",
    pause: "暂停",
    play: "播放",
    playbackFailed: "播放失败",
    playbackStarted: "已开始播放",
    playbackStopped: "播放已停止，并已释放按键。",
    previewMode: "当前是无 Tauri 后端的预览模式。",
    recentEvents: "最近事件",
    refreshMidi: "刷新 MIDI 设备",
    releaseFailed: "释放按键失败",
    releaseAllKeys: "释放所有按键",
    releasedKeys: "已释放 SlimeKeys 追踪的所有按键。",
    rules: "规则",
    ready: "准备就绪。打开 MIDI 文件或选择实时输入设备。",
    selectMidiBeforeLive: "请先选择 MIDI 输入设备再开启实时输入。",
    speed: "速度",
    stop: "停止",
    stopFailed: "停止失败",
    transpose: "移调",
    triggerHint:
      "如果连续音符听起来像一次长按，请使用 Tap 或 Retrigger，并从 8-20 ms 断开间隙开始调。",
    liveFailed: "实时输入失败",
    midiDevicesFound: "已发现 MIDI 设备",
    midiDevicesNotFound: "未发现 MIDI 输入设备。请启动 loopMIDI、创建端口，然后刷新。",
    midiDevicesRefreshFailed: "刷新 MIDI 设备失败",
    openMidiFailed: "打开 MIDI 失败",
    parsedMidiEvents: "已解析 MIDI 音符事件",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;
type TranslationMap = Partial<Record<Language, Partial<Record<TranslationKey, string>>>>;

export function createTranslator(
  language: Language,
  overrideTranslations: TranslationMap = translations,
) {
  return (key: TranslationKey): string => {
    const value = overrideTranslations[language]?.[key];
    return value && value.trim().length > 0 ? value : translations.en[key];
  };
}

export function detectLanguage(languageCode: string | undefined): Language {
  return languageCode?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

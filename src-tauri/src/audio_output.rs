use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::{self, JoinHandle};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::audition_engine::{MidiSynth, RustySynth};

const DEFAULT_SYNTH_SAMPLE_RATE: i32 = 44100;
const RUSTYSYNTH_MIN_RATE: i32 = 16_000;
const RUSTYSYNTH_MAX_RATE: i32 = 192_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Error)]
pub enum AudioOutputError {
    #[error("failed to initialize audio output: {0}")]
    Init(String),
    #[error("no playback device found")]
    NoDevice,
    #[error("failed to open playback device: {0}")]
    Open(String),
}

#[cfg(windows)]
pub fn list_audio_output_devices() -> Result<Vec<AudioOutputDevice>, AudioOutputError> {
    list_windows_audio_output_devices()
}

#[cfg(not(windows))]
pub fn list_audio_output_devices() -> Result<Vec<AudioOutputDevice>, AudioOutputError> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn init_error(err: impl ToString) -> AudioOutputError {
    AudioOutputError::Init(err.to_string())
}

#[cfg(windows)]
fn open_error(err: impl ToString) -> AudioOutputError {
    AudioOutputError::Open(err.to_string())
}

#[cfg(windows)]
fn ensure_com_initialized() -> Result<(), AudioOutputError> {
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() && hr != RPC_E_CHANGED_MODE {
        return Err(init_error(hr.message()));
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn take_pwstr(pwstr: windows::core::PWSTR) -> String {
    use windows::Win32::System::Com::CoTaskMemFree;

    if pwstr.is_null() {
        return String::new();
    }
    let value = pwstr.to_string().unwrap_or_default();
    CoTaskMemFree(Some(pwstr.0 as *const core::ffi::c_void));
    value
}

#[cfg(windows)]
unsafe fn device_id(
    device: &windows::Win32::Media::Audio::IMMDevice,
) -> Result<String, AudioOutputError> {
    let id = device.GetId().map_err(init_error)?;
    Ok(take_pwstr(id))
}

#[cfg(windows)]
unsafe fn device_name(
    device: &windows::Win32::Media::Audio::IMMDevice,
) -> Result<String, AudioOutputError> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::STGM_READ;

    let store = device.OpenPropertyStore(STGM_READ).map_err(init_error)?;
    let mut value = store
        .GetValue(&PKEY_Device_FriendlyName)
        .map_err(init_error)?;
    let name = match PropVariantToStringAlloc(&value) {
        Ok(pwstr) => take_pwstr(pwstr),
        Err(_) => String::new(),
    };
    let _ = PropVariantClear(&mut value);
    Ok(name)
}

#[cfg(windows)]
fn list_windows_audio_output_devices() -> Result<Vec<AudioOutputDevice>, AudioOutputError> {
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

    ensure_com_initialized()?;

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(init_error)?;
        let collection = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(init_error)?;
        let count = collection.GetCount().map_err(init_error)?;

        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .ok()
            .and_then(|device| device_id(&device).ok())
            .filter(|id| !id.trim().is_empty());

        let mut devices = Vec::new();
        for index in 0..count {
            let device = collection.Item(index).map_err(init_error)?;
            let id = device_id(&device)?;
            let name = device_name(&device)?;
            if id.trim().is_empty() || name.trim().is_empty() {
                continue;
            }
            let is_default = default_id.as_deref() == Some(id.as_str());
            devices.push(AudioOutputDevice {
                id,
                name,
                is_default,
            });
        }

        Ok(devices)
    }
}

pub fn resolve_audio_output_id(
    requested: Option<&str>,
    devices: &[AudioOutputDevice],
) -> Option<String> {
    if let Some(id) = requested {
        if devices.iter().any(|device| device.id == id) {
            return Some(id.to_string());
        }
    }
    default_device_id(devices)
}

fn default_device_id(devices: &[AudioOutputDevice]) -> Option<String> {
    devices
        .iter()
        .find(|device| device.is_default)
        .or_else(|| devices.first())
        .map(|device| device.id.clone())
}

fn lock_poisoned() -> AudioOutputError {
    AudioOutputError::Open("audio output lock is poisoned".into())
}

pub struct AudioStream {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

pub struct AuditionOutput {
    requested_id: Mutex<Option<String>>,
    synth: Arc<Mutex<Box<dyn MidiSynth>>>,
    stream: Mutex<Option<AudioStream>>,
    sample_rate: Mutex<i32>,
}

impl AuditionOutput {
    pub fn new() -> Result<Self, crate::audition_engine::AuditionEngineError> {
        let synth: Arc<Mutex<Box<dyn MidiSynth>>> =
            Arc::new(Mutex::new(Box::new(RustySynth::new(DEFAULT_SYNTH_SAMPLE_RATE)?)));
        Ok(Self {
            requested_id: Mutex::new(None),
            synth,
            stream: Mutex::new(None),
            sample_rate: Mutex::new(DEFAULT_SYNTH_SAMPLE_RATE),
        })
    }

    pub fn synth(&self) -> Arc<Mutex<Box<dyn MidiSynth>>> {
        self.synth.clone()
    }

    pub fn requested_id(&self) -> Option<String> {
        self.requested_id.lock().ok().and_then(|id| id.clone())
    }

    pub fn set_device(
        &self,
        device_id: Option<String>,
    ) -> Result<Option<AudioOutputDevice>, AudioOutputError> {
        if let Ok(mut synth) = self.synth.lock() {
            synth.all_notes_off();
        }
        stop_stream(&self.stream)?;

        {
            let mut requested = self.requested_id.lock().map_err(|_| lock_poisoned())?;
            *requested = device_id.clone();
        }

        let devices = list_audio_output_devices()?;
        let Some(resolved) = resolve_audio_output_id(device_id.as_deref(), &devices) else {
            return Ok(None);
        };

        let current_rate = self
            .sample_rate
            .lock()
            .map(|rate| *rate)
            .unwrap_or(DEFAULT_SYNTH_SAMPLE_RATE);

        match start_output_stream(&resolved, current_rate, self.synth.clone()) {
            Ok((stream, rate)) => {
                store_stream(self, stream, rate)?;
                Ok(find_device(&devices, &resolved))
            }
            Err(err) if device_id.is_some() => {
                let Some(default_id) = default_device_id(&devices) else {
                    eprintln!("failed to open audition playback device: {err}");
                    return Ok(None);
                };
                if default_id == resolved {
                    eprintln!("failed to open audition playback device: {err}");
                    return Ok(None);
                }
                match start_output_stream(&default_id, current_rate, self.synth.clone()) {
                    Ok((stream, rate)) => {
                        store_stream(self, stream, rate)?;
                        Ok(find_device(&devices, &default_id))
                    }
                    Err(fallback_err) => {
                        eprintln!("failed to open audition playback device: {fallback_err}");
                        Ok(None)
                    }
                }
            }
            Err(err) => {
                eprintln!("failed to open audition playback device: {err}");
                Ok(None)
            }
        }
    }
}

impl Drop for AuditionOutput {
    fn drop(&mut self) {
        let _ = stop_stream(&self.stream);
        if let Ok(mut synth) = self.synth.lock() {
            synth.all_notes_off();
        }
    }
}

fn store_stream(
    output: &AuditionOutput,
    stream: AudioStream,
    rate: i32,
) -> Result<(), AudioOutputError> {
    if let Ok(mut sample_rate) = output.sample_rate.lock() {
        *sample_rate = rate;
    }
    let mut guard = output.stream.lock().map_err(|_| lock_poisoned())?;
    *guard = Some(stream);
    Ok(())
}

fn find_device(devices: &[AudioOutputDevice], id: &str) -> Option<AudioOutputDevice> {
    devices.iter().find(|device| device.id == id).cloned()
}

fn stop_stream(stream: &Mutex<Option<AudioStream>>) -> Result<(), AudioOutputError> {
    let mut guard = stream.lock().map_err(|_| lock_poisoned())?;
    if let Some(mut existing) = guard.take() {
        existing.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = existing.handle.take() {
            let _ = handle.join();
        }
    }
    Ok(())
}

fn start_output_stream(
    device_id: &str,
    current_sample_rate: i32,
    synth: Arc<Mutex<Box<dyn MidiSynth>>>,
) -> Result<(AudioStream, i32), AudioOutputError> {
    #[cfg(windows)]
    {
        start_windows_output_stream(device_id, current_sample_rate, synth)
    }
    #[cfg(not(windows))]
    {
        let _ = (device_id, current_sample_rate, synth);
        Err(AudioOutputError::Open(
            "WASAPI is only available on Windows".into(),
        ))
    }
}

#[cfg(windows)]
fn start_windows_output_stream(
    device_id: &str,
    current_sample_rate: i32,
    synth: Arc<Mutex<Box<dyn MidiSynth>>>,
) -> Result<(AudioStream, i32), AudioOutputError> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread_stop = stop.clone();
    let thread_id = device_id.to_string();

    let handle = thread::spawn(move || {
        run_wasapi_thread(
            thread_id,
            current_sample_rate,
            thread_stop,
            synth,
            ready_tx,
        );
    });

    match ready_rx.recv() {
        Ok(Ok(rate)) => Ok((
            AudioStream {
                stop,
                handle: Some(handle),
            },
            rate,
        )),
        Ok(Err(err)) => {
            let _ = handle.join();
            Err(err)
        }
        Err(_) => {
            let _ = handle.join();
            Err(AudioOutputError::Open(
                "audio thread exited before the stream started".into(),
            ))
        }
    }
}

#[cfg(windows)]
enum WasapiWaitMode {
    /// IAudioClient event-driven shared stream (`AUDCLNT_STREAMFLAGS_EVENTCALLBACK`).
    Event,
    /// Shared stream without EVENTCALLBACK; the render loop sleeps ~10ms.
    Poll,
}

#[cfg(windows)]
fn run_wasapi_thread(
    device_id: String,
    current_sample_rate: i32,
    stop: Arc<AtomicBool>,
    synth: Arc<Mutex<Box<dyn MidiSynth>>>,
    ready_tx: mpsc::Sender<Result<i32, AudioOutputError>>,
) {
    match open_and_run_wasapi(&device_id, current_sample_rate, &stop, &synth, &ready_tx) {
        Ok(()) => {}
        Err(err) => {
            let _ = ready_tx.send(Err(err));
        }
    }
}

#[cfg(windows)]
fn open_and_run_wasapi(
    device_id: &str,
    current_sample_rate: i32,
    stop: &Arc<AtomicBool>,
    synth: &Arc<Mutex<Box<dyn MidiSynth>>>,
    ready_tx: &mpsc::Sender<Result<i32, AudioOutputError>>,
) -> Result<(), AudioOutputError> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        IAudioClient, IAudioRenderClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
    const IEEE_FLOAT_SUBTYPE: windows::core::GUID =
        windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
    const BUFFER_HNS: i64 = 200_000;
    const EVENT_WAIT_MS: u32 = 50;
    const POLL_SLEEP_MS: u64 = 10;

    ensure_com_initialized().map_err(|err| AudioOutputError::Open(err.to_string()))?;

    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.map_err(open_error)?;
    let device = unsafe { enumerator.GetDevice(&HSTRING::from(device_id)) }.map_err(open_error)?;

    let probe: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(open_error)?;
    let mix = unsafe { probe.GetMixFormat() }.map_err(open_error)?;
    if mix.is_null() {
        return Err(AudioOutputError::Open("mix format is null".into()));
    }

    let (sample_rate, wait_mode, client) = unsafe {
        let format = std::ptr::read_unaligned(mix);
        let tag = format.wFormatTag;
        let channels = format.nChannels;
        let bits = format.wBitsPerSample;
        let samples_per_sec = format.nSamplesPerSec;
        let cb_size = format.cbSize;
        let supported = match tag {
            WAVE_FORMAT_IEEE_FLOAT => channels == 2 && bits == 32,
            WAVE_FORMAT_EXTENSIBLE if cb_size >= 22 => {
                let ext = std::ptr::read_unaligned(mix as *const WAVEFORMATEXTENSIBLE);
                let ext_channels = ext.Format.nChannels;
                let ext_bits = ext.Format.wBitsPerSample;
                let sub_format = std::ptr::read_unaligned(std::ptr::addr_of!(ext.SubFormat));
                ext_channels == 2 && ext_bits == 32 && sub_format == IEEE_FLOAT_SUBTYPE
            }
            _ => false,
        };
        if !supported {
            CoTaskMemFree(Some(mix as *const core::ffi::c_void));
            return Err(AudioOutputError::Open(format!(
                "unsupported mix format: tag={tag} channels={channels} bits={bits}"
            )));
        }

        let initialized = initialize_shared_client(&device, &probe, mix, BUFFER_HNS);
        CoTaskMemFree(Some(mix as *const core::ffi::c_void));
        let (wait_mode, client) = initialized?;
        let sample_rate = (samples_per_sec as i32).clamp(RUSTYSYNTH_MIN_RATE, RUSTYSYNTH_MAX_RATE);
        (sample_rate, wait_mode, client)
    };

    if current_sample_rate != sample_rate {
        let replacement = RustySynth::new(sample_rate)
            .map_err(|err| AudioOutputError::Open(err.to_string()))?;
        let mut synth = synth.lock().map_err(|_| lock_poisoned())?;
        *synth = Box::new(replacement);
    }

    let event = match wait_mode {
        WasapiWaitMode::Event => {
            let handle = unsafe { CreateEventW(None, false, false, windows::core::PCWSTR::null()) }
                .map_err(open_error)?;
            unsafe { client.SetEventHandle(handle) }.map_err(|err| {
                let _ = unsafe { CloseHandle(handle) };
                open_error(err)
            })?;
            Some(handle)
        }
        WasapiWaitMode::Poll => None,
    };

    let render: IAudioRenderClient = unsafe { client.GetService() }.map_err(|err| {
        if let Some(handle) = event {
            let _ = unsafe { CloseHandle(handle) };
        }
        open_error(err)
    })?;
    let buffer_size = unsafe { client.GetBufferSize() }.map_err(|err| {
        if let Some(handle) = event {
            let _ = unsafe { CloseHandle(handle) };
        }
        open_error(err)
    })?;
    unsafe { client.Start() }.map_err(|err| {
        if let Some(handle) = event {
            let _ = unsafe { CloseHandle(handle) };
        }
        open_error(err)
    })?;

    if ready_tx.send(Ok(sample_rate)).is_err() {
        let _ = unsafe { client.Stop() };
        if let Some(handle) = event {
            let _ = unsafe { CloseHandle(handle) };
        }
        return Ok(());
    }

    let mut left = Vec::new();
    let mut right = Vec::new();

    while !stop.load(Ordering::SeqCst) {
        match wait_mode {
            WasapiWaitMode::Event => {
                if let Some(handle) = event {
                    let _ = unsafe { WaitForSingleObject(handle, EVENT_WAIT_MS) } == WAIT_OBJECT_0;
                }
            }
            WasapiWaitMode::Poll => {
                thread::sleep(std::time::Duration::from_millis(POLL_SLEEP_MS));
            }
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }

        let padding = match unsafe { client.GetCurrentPadding() } {
            Ok(padding) => padding,
            Err(_) => continue,
        };
        let frames = buffer_size.saturating_sub(padding);
        if frames == 0 {
            continue;
        }

        left.resize(frames as usize, 0.0);
        right.resize(frames as usize, 0.0);
        left.fill(0.0);
        right.fill(0.0);
        if let Ok(mut synth) = synth.lock() {
            synth.render(&mut left, &mut right);
        }

        let data = match unsafe { render.GetBuffer(frames) } {
            Ok(data) if !data.is_null() => data,
            _ => continue,
        };
        let samples = unsafe { std::slice::from_raw_parts_mut(data as *mut f32, frames as usize * 2) };
        for index in 0..frames as usize {
            samples[index * 2] = left[index];
            samples[index * 2 + 1] = right[index];
        }
        let _ = unsafe { render.ReleaseBuffer(frames, 0) };
    }

    if let Ok(mut synth) = synth.lock() {
        synth.all_notes_off();
    }
    let _ = unsafe { client.Stop() };
    if let Some(handle) = event {
        let _ = unsafe { CloseHandle(handle) };
    }
    Ok(())
}

#[cfg(windows)]
unsafe fn initialize_shared_client(
    device: &windows::Win32::Media::Audio::IMMDevice,
    probe: &windows::Win32::Media::Audio::IAudioClient,
    mix: *mut windows::Win32::Media::Audio::WAVEFORMATEX,
    buffer_hns: i64,
) -> Result<(WasapiWaitMode, windows::Win32::Media::Audio::IAudioClient), AudioOutputError> {
    use windows::Win32::Media::Audio::{
        IAudioClient, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    };
    use windows::Win32::System::Com::CLSCTX_ALL;

    // Shared-mode EVENTCALLBACK + non-zero hnsPeriodicity is usually rejected
    // (periodicity must be 0). Try the task-specified combo first, then
    // EVENTCALLBACK with periodicity 0. If both fail, drop EVENTCALLBACK and poll.
    if probe
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            buffer_hns,
            buffer_hns,
            mix,
            None,
        )
        .is_ok()
    {
        return Ok((WasapiWaitMode::Event, probe.clone()));
    }

    let event_client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(open_error)?;
    if event_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            buffer_hns,
            0,
            mix,
            None,
        )
        .is_ok()
    {
        return Ok((WasapiWaitMode::Event, event_client));
    }

    let poll_client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(open_error)?;
    poll_client
        .Initialize(AUDCLNT_SHAREMODE_SHARED, 0, buffer_hns, 0, mix, None)
        .map_err(open_error)?;
    Ok((WasapiWaitMode::Poll, poll_client))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn devices() -> Vec<AudioOutputDevice> {
        vec![
            AudioOutputDevice {
                id: "speakers".into(),
                name: "Speakers".into(),
                is_default: true,
            },
            AudioOutputDevice {
                id: "headphones".into(),
                name: "Headphones".into(),
                is_default: false,
            },
        ]
    }

    #[test]
    fn follow_default_uses_the_default_device() {
        assert_eq!(
            resolve_audio_output_id(None, &devices()).as_deref(),
            Some("speakers")
        );
    }

    #[test]
    fn listed_id_is_used() {
        assert_eq!(
            resolve_audio_output_id(Some("headphones"), &devices()).as_deref(),
            Some("headphones")
        );
    }

    #[test]
    fn unknown_id_falls_back_to_default() {
        assert_eq!(
            resolve_audio_output_id(Some("missing"), &devices()).as_deref(),
            Some("speakers")
        );
    }

    #[test]
    fn empty_list_resolves_to_none() {
        assert_eq!(resolve_audio_output_id(Some("headphones"), &[]), None);
        assert_eq!(resolve_audio_output_id(None, &[]), None);
    }

    #[test]
    fn audio_output_device_list_is_queryable() {
        let devices = list_audio_output_devices().unwrap();
        assert!(devices.iter().all(|device| !device.name.trim().is_empty()));
        assert!(devices.iter().all(|device| !device.id.trim().is_empty()));
        let defaults = devices.iter().filter(|device| device.is_default).count();
        assert!(devices.is_empty() || defaults == 1);
    }

    #[test]
    fn set_device_none_opens_default_when_devices_exist() {
        let devices = list_audio_output_devices().unwrap();
        if devices.is_empty() {
            return;
        }
        let output = AuditionOutput::new().unwrap();
        let opened = output.set_device(None).unwrap();
        assert!(opened.is_some());
        assert!(opened.unwrap().is_default || devices.iter().any(|device| device.is_default));
    }
}

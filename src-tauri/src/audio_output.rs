use serde::{Deserialize, Serialize};
use thiserror::Error;

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
fn list_windows_audio_output_devices() -> Result<Vec<AudioOutputDevice>, AudioOutputError> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };

    fn init_error(err: impl ToString) -> AudioOutputError {
        AudioOutputError::Init(err.to_string())
    }

    unsafe fn take_pwstr(pwstr: windows::core::PWSTR) -> String {
        if pwstr.is_null() {
            return String::new();
        }
        let value = pwstr.to_string().unwrap_or_default();
        CoTaskMemFree(Some(pwstr.0 as *const core::ffi::c_void));
        value
    }

    unsafe fn device_id(device: &IMMDevice) -> Result<String, AudioOutputError> {
        let id = device.GetId().map_err(init_error)?;
        Ok(take_pwstr(id))
    }

    unsafe fn device_name(device: &IMMDevice) -> Result<String, AudioOutputError> {
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

    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(init_error(hr.message()));
        }

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
}

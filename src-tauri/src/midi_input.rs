use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiInputDevice {
    pub id: usize,
    pub name: String,
    pub source: MidiInputSource,
    pub available_for_live: bool,
    pub note: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MidiInputSource {
    WinMm,
    WindowsMidiServices,
}

#[derive(Debug, Error)]
pub enum MidiInputError {
    #[error("failed to initialize MIDI input: {0}")]
    Init(String),
    #[error("failed to read MIDI input port name: {0}")]
    PortName(String),
}

pub fn list_midi_input_devices() -> Result<Vec<MidiInputDevice>, MidiInputError> {
    let mut devices = list_runtime_midi_input_devices()?;
    append_windows_midi_services_devices(&mut devices);
    Ok(devices)
}

fn list_runtime_midi_input_devices() -> Result<Vec<MidiInputDevice>, MidiInputError> {
    let input =
        midir::MidiInput::new("SlimeKeys").map_err(|err| MidiInputError::Init(err.to_string()))?;

    input
        .ports()
        .iter()
        .enumerate()
        .map(|(id, port)| {
            input
                .port_name(port)
                .map(|name| MidiInputDevice {
                    id,
                    name,
                    source: runtime_midi_input_source(),
                    available_for_live: true,
                    note: None,
                })
                .map_err(|err| MidiInputError::PortName(err.to_string()))
        })
        .collect()
}

#[cfg(windows)]
fn runtime_midi_input_source() -> MidiInputSource {
    MidiInputSource::WindowsMidiServices
}

#[cfg(not(windows))]
fn runtime_midi_input_source() -> MidiInputSource {
    MidiInputSource::WinMm
}

#[cfg(windows)]
fn append_windows_midi_services_devices(devices: &mut Vec<MidiInputDevice>) {
    append_windows_midi_services_device_names(devices, windows_midi_services_device_names());
}

#[cfg(not(windows))]
fn append_windows_midi_services_devices(_devices: &mut Vec<MidiInputDevice>) {}

#[cfg(windows)]
fn windows_midi_services_device_names() -> Vec<String> {
    use std::process::Command;

    let script = r#"
Get-PnpDevice -PresentOnly |
  Where-Object {
    ($_.Class -eq 'SoftwareDevice') -and
    (
      $_.InstanceId -like 'SWD\MMDEVAPI\MIDI*' -or
      $_.InstanceId -like 'SWD\MIDISRV\MIDI*'
    )
  } |
  Where-Object {
    $_.FriendlyName -and
    $_.FriendlyName -notmatch 'Service Test|Internal|Transport|Virtual Devices|Loop Devices|GS 波表|GS Wavetable'
  } |
  Select-Object -ExpandProperty FriendlyName
"#;

    Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_device_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn append_windows_midi_services_device_names(
    devices: &mut Vec<MidiInputDevice>,
    names: Vec<String>,
) {
    let mut known_names = devices
        .iter()
        .map(|device| normalize_device_name(&device.name))
        .collect::<std::collections::BTreeSet<_>>();

    for name in names {
        if !known_names.insert(normalize_device_name(&name)) {
            continue;
        }

        devices.push(MidiInputDevice {
            id: devices.len(),
            name,
            source: MidiInputSource::WindowsMidiServices,
            available_for_live: false,
            note: Some(
                "Detected by Windows, but it is not exposed to SlimeKeys' live input backend yet."
                    .to_string(),
            ),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_input_device_list_is_queryable() {
        let devices = list_midi_input_devices().unwrap();
        assert!(devices.iter().all(|device| !device.name.trim().is_empty()));
    }

    #[test]
    fn windows_midi_services_devices_are_appended_without_duplicates() {
        let mut devices = vec![MidiInputDevice {
            id: 0,
            name: "loopMIDI Port".to_string(),
            source: MidiInputSource::WinMm,
            available_for_live: true,
            note: None,
        }];

        append_test_devices(
            &mut devices,
            vec!["loopMIDI Port".to_string(), "MIDI 2 Port".to_string()],
        );

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[1].name, "MIDI 2 Port");
        assert_eq!(devices[1].source, MidiInputSource::WindowsMidiServices);
        assert!(!devices[1].available_for_live);
    }

    #[test]
    fn duplicate_windows_midi_services_names_are_collapsed() {
        let mut devices = Vec::new();

        append_test_devices(
            &mut devices,
            vec!["loopMIDI Port".to_string(), "loopMIDI Port".to_string()],
        );

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "loopMIDI Port");
    }

    #[cfg(windows)]
    #[test]
    fn loopmidi_windows_services_device_is_available_for_live_when_present() {
        let has_loopmidi = windows_midi_services_device_names()
            .iter()
            .any(|name| normalize_device_name(name) == normalize_device_name("loopMIDI Port"));
        if !has_loopmidi {
            return;
        }

        let devices = list_midi_input_devices().unwrap();
        let loopmidi = devices
            .iter()
            .find(|device| {
                normalize_device_name(&device.name) == normalize_device_name("loopMIDI Port")
            })
            .expect("loopMIDI Port should be listed when Windows reports it");

        assert!(
            loopmidi.available_for_live,
            "loopMIDI Port was detected but is not available for Live: {devices:?}"
        );
    }

    fn append_test_devices(devices: &mut Vec<MidiInputDevice>, names: Vec<String>) {
        append_windows_midi_services_device_names(devices, names);
    }
}

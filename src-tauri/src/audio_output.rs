use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
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
}

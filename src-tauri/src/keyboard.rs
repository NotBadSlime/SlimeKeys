use std::collections::BTreeSet;

use thiserror::Error;

pub type KeyboardResult<T> = Result<T, KeyboardOutputError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum KeyboardOutputError {
    #[error("unknown key: {0}")]
    UnknownKey(String),
    #[error("failed to send keyboard input for key: {0}")]
    SendFailed(String),
}

pub trait KeyboardSink {
    fn key_down(&mut self, key: &str) -> KeyboardResult<()>;
    fn key_up(&mut self, key: &str) -> KeyboardResult<()>;
}

#[derive(Clone, Debug)]
pub struct TrackedKeyboardOutput<S> {
    sink: S,
    held_keys: BTreeSet<String>,
}

impl<S: KeyboardSink> TrackedKeyboardOutput<S> {
    pub fn new(sink: S) -> Self {
        Self {
            sink,
            held_keys: BTreeSet::new(),
        }
    }

    pub fn sink(&self) -> &S {
        &self.sink
    }

    pub fn key_down(&mut self, key: &str) -> KeyboardResult<()> {
        let key = normalize_key_name(key)?;
        self.sink.key_down(&key)?;
        self.held_keys.insert(key);
        Ok(())
    }

    pub fn key_up(&mut self, key: &str) -> KeyboardResult<()> {
        let key = normalize_key_name(key)?;
        self.sink.key_up(&key)?;
        self.held_keys.remove(&key);
        Ok(())
    }

    pub fn release_all(&mut self) -> KeyboardResult<()> {
        let held_keys = self.held_keys.iter().cloned().collect::<Vec<_>>();
        for key in held_keys {
            self.sink.key_up(&key)?;
            self.held_keys.remove(&key);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct NoopKeyboardSink;

impl KeyboardSink for NoopKeyboardSink {
    fn key_down(&mut self, key: &str) -> KeyboardResult<()> {
        normalize_key_name(key).map(|_| ())
    }

    fn key_up(&mut self, key: &str) -> KeyboardResult<()> {
        normalize_key_name(key).map(|_| ())
    }
}

#[cfg(windows)]
#[derive(Clone, Debug, Default)]
pub struct WindowsKeyboardSink;

#[cfg(windows)]
impl KeyboardSink for WindowsKeyboardSink {
    fn key_down(&mut self, key: &str) -> KeyboardResult<()> {
        send_windows_key(key, false)
    }

    fn key_up(&mut self, key: &str) -> KeyboardResult<()> {
        send_windows_key(key, true)
    }
}

pub fn normalize_key_name(key: &str) -> KeyboardResult<String> {
    let normalized = key.trim().to_uppercase();
    key_to_virtual_key(&normalized)?;
    Ok(normalized)
}

fn key_to_virtual_key(key: &str) -> KeyboardResult<u16> {
    if key.len() == 1 {
        let byte = key.as_bytes()[0];
        if byte.is_ascii_uppercase() || byte.is_ascii_digit() {
            return Ok(byte as u16);
        }
    }

    match key {
        "SPACE" => Ok(0x20),
        "ENTER" => Ok(0x0D),
        "TAB" => Ok(0x09),
        "ESC" | "ESCAPE" => Ok(0x1B),
        "BACKSPACE" => Ok(0x08),
        "LEFT" => Ok(0x25),
        "UP" => Ok(0x26),
        "RIGHT" => Ok(0x27),
        "DOWN" => Ok(0x28),
        "SHIFT" => Ok(0x10),
        "CTRL" | "CONTROL" => Ok(0x11),
        "ALT" => Ok(0x12),
        _ => Err(KeyboardOutputError::UnknownKey(key.to_string())),
    }
}

#[cfg(windows)]
fn send_windows_key(key: &str, key_up: bool) -> KeyboardResult<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };

    let vk = key_to_virtual_key(key)?;
    let flags = if key_up {
        KEYEVENTF_KEYUP
    } else {
        KEYBD_EVENT_FLAGS(0)
    };
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let sent = unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };

    if sent == 1 {
        Ok(())
    } else {
        Err(KeyboardOutputError::SendFailed(key.to_string()))
    }
}

#[cfg(test)]
#[derive(Clone, Debug, Default)]
pub struct FakeKeyboardSink {
    events: Vec<String>,
}

#[cfg(test)]
impl FakeKeyboardSink {
    pub fn events(&self) -> Vec<String> {
        self.events.clone()
    }
}

#[cfg(test)]
impl KeyboardSink for FakeKeyboardSink {
    fn key_down(&mut self, key: &str) -> KeyboardResult<()> {
        let key = normalize_key_name(key)?;
        self.events.push(format!("down:{key}"));
        Ok(())
    }

    fn key_up(&mut self, key: &str) -> KeyboardResult<()> {
        let key = normalize_key_name(key)?;
        self.events.push(format!("up:{key}"));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_output_releases_all_held_keys() {
        let fake = FakeKeyboardSink::default();
        let mut output = TrackedKeyboardOutput::new(fake);

        output.key_down("A").unwrap();
        output.key_down("S").unwrap();
        output.release_all().unwrap();

        assert_eq!(
            output.sink().events(),
            vec!["down:A", "down:S", "up:A", "up:S"]
        );
    }

    #[test]
    fn tracked_output_rejects_unknown_keys() {
        let fake = FakeKeyboardSink::default();
        let mut output = TrackedKeyboardOutput::new(fake);

        let err = output.key_down("not-a-key").unwrap_err();

        assert!(err.to_string().contains("unknown key"));
        assert!(output.sink().events().is_empty());
    }
}

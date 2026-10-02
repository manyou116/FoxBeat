use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub animal: String,
    pub dance: String,
    pub mode: String,
    pub keyboard: bool,
    pub mouse_click: bool,
    pub mouse_scroll: bool,
    pub all_keys: bool,
    pub size: f64,
    pub opacity: f64,
    pub sensitivity: f64,
    pub reduced_motion: bool,
    pub autostart: bool,
    pub easter_eggs: bool,
    pub speech_enabled: bool,
    pub automatic_update_checks: bool,
    pub preview_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            animal: "fox".into(),
            dance: "sway".into(),
            mode: "continuous".into(),
            keyboard: true,
            mouse_click: false,
            mouse_scroll: false,
            all_keys: false,
            size: 180.0,
            opacity: 1.0,
            sensitivity: 1.0,
            reduced_motion: false,
            autostart: false,
            easter_eggs: true,
            speech_enabled: true,
            automatic_update_checks: true,
            preview_updates: true,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if ![
            "fox",
            "emojiFox",
            "girl",
            "cat",
            "capybara",
            "shyFox",
            "yuexinCat",
            "orangeFox",
            "dancingFox",
        ]
        .contains(&self.animal.as_str())
        {
            return Err("没有找到这位舞伴".into());
        }
        if !["sway", "step", "wave", "sanwei"].contains(&self.dance.as_str()) {
            return Err("没有找到这套舞蹈".into());
        }
        if self.animal == "dancingFox" && self.dance != "sanwei" {
            return Err("跳跳狐只能使用散味舞".into());
        }
        if self.dance == "sanwei" && self.animal != "dancingFox" {
            return Err("散味舞只属于跳跳狐".into());
        }
        if !["continuous", "step"].contains(&self.mode.as_str()) {
            return Err("舞蹈模式不正确".into());
        }
        for (value, min, max, label) in [
            (self.size, 96.0, 320.0, "尺寸"),
            (self.opacity, 0.3, 1.0, "透明度"),
            (self.sensitivity, 0.5, 1.5, "灵敏度"),
        ] {
            if !value.is_finite() || value < min || value > max {
                return Err(format!("{label}超出允许范围"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Stored {
    pub settings: Settings,
    pub position: Option<Position>,
}

pub fn load(path: &Path) -> Result<Stored, String> {
    if !path.exists() {
        return Ok(Stored::default());
    }
    let bytes = fs::read(path).map_err(|_| "无法读取本地设置".to_string())?;
    let value: Stored =
        serde_json::from_slice(&bytes).map_err(|_| "本地设置损坏，已使用默认设置".to_string())?;
    value.settings.validate()?;
    Ok(value)
}

pub fn save(path: &Path, data: &Stored) -> Result<(), String> {
    data.settings.validate()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "无法创建设置目录".to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(data).map_err(|_| "无法保存设置".to_string())?;
    // QSaveFile-like replacement, with no partial JSON written to the live file.
    let temp = path.with_extension("json.tmp");
    use std::io::Write;
    let mut file = fs::File::create(&temp).map_err(|_| "无法写入设置文件".to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "设置写入未完成".to_string())?;
    drop(file);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err("无法替换设置文件".into());
        }
    }
    #[cfg(not(target_os = "windows"))]
    fs::rename(&temp, path).map_err(|_| "无法替换设置文件".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_supported_theme_combinations_are_valid() {
        for animal in [
            "fox",
            "emojiFox",
            "girl",
            "cat",
            "capybara",
            "shyFox",
            "yuexinCat",
            "orangeFox",
        ] {
            for dance in ["sway", "step", "wave"] {
                let s = Settings {
                    animal: animal.into(),
                    dance: dance.into(),
                    ..Settings::default()
                };
                assert!(s.validate().is_ok());
            }
        }
        let dancing = Settings { animal: "dancingFox".into(), dance: "sanwei".into(), ..Settings::default() };
        assert!(dancing.validate().is_ok());
        let invalid = Settings { animal: "dancingFox".into(), dance: "sway".into(), ..Settings::default() };
        assert!(invalid.validate().is_err());
        let invalid = Settings { animal: "fox".into(), dance: "sanwei".into(), ..Settings::default() };
        assert!(invalid.validate().is_err());
    }
    #[test]
    fn prevents_invisible_or_unbounded_pets() {
        let mut s = Settings::default();
        s.opacity = 0.0;
        assert!(s.validate().is_err());
        s.opacity = 1.0;
        s.size = f64::NAN;
        assert!(s.validate().is_err());
        s.size = 180.0;
        s.animal = "unsupported".into();
        assert!(s.validate().is_err());
    }
    #[test]
    fn old_config_can_gain_new_defaults() {
        let s: Settings = serde_json::from_str(r#"{"animal":"cat","mode":"step"}"#).unwrap();
        assert_eq!(s.animal, "cat");
        assert_eq!(s.size, 180.0);
        assert!(s.keyboard);
        assert!(s.speech_enabled);
        assert!(s.automatic_update_checks);
        assert!(s.preview_updates);
    }
    #[test]
    fn preserves_negative_monitor_coordinates_and_replaces_settings() {
        let dir = std::env::temp_dir().join(format!("foxbeat-settings-{}", std::process::id()));
        let path = dir.join("settings.json");
        let mut stored = Stored {
            position: Some(Position { x: -1280, y: -200 }),
            ..Stored::default()
        };
        save(&path, &stored).unwrap();
        stored.settings.animal = "dancingFox".into();
        stored.settings.dance = "sanwei".into();
        save(&path, &stored).unwrap();
        let read = load(&path).unwrap();
        assert_eq!(read.position.unwrap().x, -1280);
        assert_eq!(read.settings.animal, "dancingFox");
        assert_eq!(read.settings.dance, "sanwei");
        fs::write(&path, "{").unwrap();
        assert!(load(&path).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}

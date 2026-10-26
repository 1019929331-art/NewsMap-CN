use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub idle_minutes: u32,
    #[serde(default)]
    pub weather_city: Option<String>,
    #[serde(default = "default_daily_quote")]
    pub daily_quote: bool,
    #[serde(default)]
    pub countdown_title: Option<String>,
    #[serde(default)]
    pub countdown_date: Option<String>,
    #[serde(default)]
    pub countdown_time: Option<String>,
}

fn default_daily_quote() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_minutes: 5,
            weather_city: None,
            daily_quote: true,
            countdown_title: None,
            countdown_date: None,
            countdown_time: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub title: String,
    pub url: Option<String>,
    pub province: Option<String>,
    pub summary: String,
    pub saved_at: String,
}

pub fn load_settings(dir: &Path) -> Settings {
    fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(dir: &Path, settings: &Settings) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(
        dir.join("settings.json"),
        serde_json::to_string_pretty(settings).map_err(io_error)?,
    )
}

pub fn load_favorites(dir: &Path) -> Vec<Favorite> {
    fs::read_to_string(dir.join("favorites.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_favorites(dir: &Path, favorites: &[Favorite]) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::write(
        dir.join("favorites.json"),
        serde_json::to_string_pretty(favorites).map_err(io_error)?,
    )
}

fn io_error(e: serde_json::Error) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_keep_working_with_new_defaults() {
        let settings: Settings = serde_json::from_str(
            r#"{"enabled":true,"idleMinutes":8,"weatherCity":"北京|101010100"}"#,
        )
        .unwrap();

        assert!(settings.daily_quote);
        assert_eq!(settings.countdown_title, None);
        assert_eq!(settings.countdown_date, None);
        assert_eq!(settings.countdown_time, None);
    }
}

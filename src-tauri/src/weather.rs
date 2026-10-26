use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherResult {
    pub ok: bool,
    pub from_cache: bool,
    pub city: Option<String>,
    pub temp: Option<String>,
    pub high: Option<String>,
    pub low: Option<String>,
    pub condition: Option<String>,
    pub message: Option<String>,
    pub updated_at: Option<u64>,
}

#[derive(Deserialize)]
struct Sk2d {
    cityname: Option<String>,
    temp: Option<String>,
    weather: Option<String>,
}

#[derive(Deserialize)]
struct Dingzhi {
    weatherinfo: Option<DingzhiInfo>,
}

#[derive(Deserialize)]
struct DingzhiInfo {
    cityname: Option<String>,
    temp: Option<String>,
    tempn: Option<String>,
    weather: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct WeatherCache {
    city_id: String,
    #[serde(default)]
    updated_at: Option<u64>,
    city: Option<String>,
    temp: Option<String>,
    high: Option<String>,
    low: Option<String>,
    condition: Option<String>,
}

const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/// 从 `var dataSK={...}` 这类 JS 包裹的响应里截取 JSON 对象
fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    for (i, b) in bytes.iter().enumerate().skip(start) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Option<String> {
    client
        .get(url)
        .header("User-Agent", UA)
        .header("Referer", "https://www.weather.com.cn/")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()
}

pub async fn fetch_weather(client: &reqwest::Client, city_id: &str, data_dir: &Path) -> WeatherResult {
    let mut out = WeatherResult {
        ok: false,
        from_cache: false,
        city: None,
        temp: None,
        high: None,
        low: None,
        condition: None,
        message: None,
        updated_at: None,
    };
    // 实时：当前温度 + 天气
    if let Some(text) = fetch_text(client, &format!("https://d1.weather.com.cn/sk_2d/{}.html", city_id)).await {
        if let Some(json) = extract_json(&text) {
            if let Ok(v) = serde_json::from_str::<Sk2d>(json) {
                out.city = v.cityname;
                out.temp = v.temp;
                out.condition = v.weather;
            }
        }
    }
    // 预报：当日最高/最低温
    if let Some(text) = fetch_text(client, &format!("https://d1.weather.com.cn/dingzhi/{}.html", city_id)).await {
        if let Some(json) = extract_json(&text) {
            if let Ok(v) = serde_json::from_str::<Dingzhi>(json) {
                if let Some(info) = v.weatherinfo {
                    if out.city.is_none() {
                        out.city = info.cityname;
                    }
                    out.high = info.temp;
                    out.low = info.tempn;
                    if out.condition.is_none() {
                        out.condition = info.weather;
                    }
                }
            }
        }
    }
    out.ok = out.temp.is_some() && out.high.is_some() && out.low.is_some();
    if !out.ok {
        // 断网兜底：回退到磁盘缓存
        if let Some(cached) = load_weather_cache(data_dir, city_id) {
            return WeatherResult {
                ok: true,
                from_cache: true,
                city: cached.city,
                temp: cached.temp,
                high: cached.high,
                low: cached.low,
                condition: cached.condition,
                message: Some("使用缓存数据".to_string()),
                updated_at: cached.updated_at,
            };
        }
        out.message = Some("天气数据获取失败".to_string());
    } else {
        out.updated_at = Some(now_seconds());
        save_weather_cache(data_dir, city_id, &out);
    }
    out
}

fn weather_cache_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("weather_cache.json")
}

fn load_weather_cache(data_dir: &Path, city_id: &str) -> Option<WeatherCache> {
    let text = std::fs::read_to_string(weather_cache_path(data_dir)).ok()?;
    let cached: WeatherCache = serde_json::from_str(&text).ok()?;
    if cached.city_id == city_id {
        Some(cached)
    } else {
        None
    }
}

fn save_weather_cache(data_dir: &Path, city_id: &str, out: &WeatherResult) {
    let _ = std::fs::create_dir_all(data_dir);
    let cache = WeatherCache {
        city_id: city_id.to_string(),
        updated_at: out.updated_at,
        city: out.city.clone(),
        temp: out.temp.clone(),
        high: out.high.clone(),
        low: out.low.clone(),
        condition: out.condition.clone(),
    };
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(weather_cache_path(data_dir), json);
    }
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

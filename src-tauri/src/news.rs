use crate::classify;
use crate::AppState;
use serde::{Deserialize, Deserializer, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub url: Option<String>,
    pub cover: Option<String>,
    pub hot: u64,
    pub province: Option<String>,
    #[serde(default)]
    pub location_match: Option<String>,
    pub sentiment: String,
    pub is_disaster: bool,
    pub rank: usize,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub ok: bool,
    pub items: Vec<NewsItem>,
    pub from_cache: bool,
    pub message: Option<String>,
    pub updated_at: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct NewsCache {
    pub updated_at: Option<u64>,
    pub items: Vec<NewsItem>,
}

#[derive(Deserialize)]
struct ToutiaoResponse {
    data: Vec<ToutiaoItem>,
}

#[derive(Deserialize)]
struct ToutiaoItem {
    #[serde(rename = "Title")]
    title: Option<String>,
    #[serde(rename = "Url")]
    url: Option<String>,
    #[serde(rename = "Image")]
    image: Option<ToutiaoImage>,
    #[serde(rename = "HotValue")]
    #[serde(deserialize_with = "de_u64_value")]
    hot: Option<u64>,
    #[serde(rename = "ClusterIdStr")]
    cluster_id_str: Option<String>,
}

/// 头条的 HotValue 有时是数字有时是字符串，两种都接受。
fn de_u64_value<'de, D>(d: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    Ok(v.and_then(|x| {
        x.as_u64()
            .or_else(|| x.as_str().and_then(|s| s.parse().ok()))
    }))
}

#[derive(Deserialize)]
struct ToutiaoImage {
    #[serde(rename = "url")]
    url: Option<String>,
}

#[derive(Deserialize)]
struct RssFeed {
    channel: RssChannel,
}

#[derive(Deserialize)]
struct RssChannel {
    item: Vec<RssItem>,
}

#[derive(Deserialize)]
struct RssItem {
    title: String,
    link: String,
    description: Option<String>,
    #[serde(rename = "pubDate")]
    pub_date: Option<String>,
}

const TOUTIAO_URL: &str = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";
const ITHOME_URL: &str = "https://www.ithome.com/rss/";
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

pub async fn fetch_news(state: &AppState) -> FetchResult {
    let result: Result<(Vec<NewsItem>, u64), String> = async {
        let client = state.client.clone();
        let tech_task = tauri::async_runtime::spawn(async move { fetch_ithome(&client).await });
        let hot = fetch_toutiao(state).await;
        let tech = tech_task.await.unwrap_or_else(|e| Err(e.to_string()));
        let mut hot = hot.unwrap_or_default();
        let mut tech = tech.unwrap_or_default();
        if hot.is_empty() && tech.is_empty() {
            return Err("免费新闻源暂不可用或没有有效新闻".to_string());
        }
        hot.truncate(25);
        tech.truncate(5);
        let mut items: Vec<NewsItem> = hot.drain(..hot.len().min(4)).collect();
        if !tech.is_empty() {
            items.push(tech.remove(0));
        }
        items.extend(hot);
        items.extend(tech);
        for (i, it) in items.iter_mut().enumerate() {
            it.rank = i + 1;
        }
        let updated_at = now_seconds();
        // 已缓存的封面直接使用；新封面在返回新闻后下载。
        let mut pending_covers = Vec::new();
        for it in items.iter_mut().take(10) {
            if let Some(url) = it.cover.clone() {
                if let Some(p) = local_cover(&url, &state.data_dir) {
                    it.cover = Some(p);
                } else {
                    pending_covers.push(url);
                }
            }
        }
        if !pending_covers.is_empty() {
            let client = state.client.clone();
            let data_dir = state.data_dir.clone();
            tauri::async_runtime::spawn(async move {
                for url in pending_covers {
                    let _ = cache_cover(&client, &url, &data_dir).await;
                }
            });
        }
        Ok((items, updated_at))
    }
    .await;

    match result {
        Ok((items, fetched_at)) => {
            let updated_at = Some(fetched_at);
            let cache = NewsCache { updated_at, items: items.clone() };
            *state.news_cache.lock().unwrap() = Some(cache.clone());
            save_news_cache(&state.data_dir, &cache);
            FetchResult {
                ok: true,
                items,
                from_cache: false,
                message: None,
                updated_at,
            }
        }
        Err(e) => {
            let cached = state.news_cache.lock().unwrap().clone()
                .or_else(|| load_news_cache(&state.data_dir));
            let mut items = cached.as_ref().map(|c| c.items.clone()).unwrap_or_default();
            use_local_covers(&mut items, &state.data_dir);
            FetchResult {
                ok: false,
                items,
                from_cache: true,
                message: Some(e),
                updated_at: cached.and_then(|c| c.updated_at),
            }
        }
    }
}

async fn fetch_toutiao(state: &AppState) -> Result<Vec<NewsItem>, String> {
    let resp = state
        .client
        .get(TOUTIAO_URL)
        .header("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }
    let parsed: ToutiaoResponse =
        serde_json::from_str(&text).map_err(|e| format!("解析失败: {}", e))?;
    let mut items: Vec<NewsItem> = parsed.data.iter().filter_map(to_item).collect();
    items.sort_by(|a, b| b.hot.cmp(&a.hot));
    Ok(items)
}

async fn fetch_ithome(client: &reqwest::Client) -> Result<Vec<NewsItem>, String> {
    let text = client
        .get(ITHOME_URL)
        .header("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    parse_ithome(&text)
}

fn parse_ithome(xml: &str) -> Result<Vec<NewsItem>, String> {
    let feed: RssFeed = quick_xml::de::from_str(xml).map_err(|e| e.to_string())?;
    Ok(feed.channel.item.into_iter().filter_map(|entry| {
        let title = entry.title.trim().to_string();
        let url = entry.link.trim().to_string();
        if title.is_empty() || !url.starts_with("https://www.ithome.com/") {
            return None;
        }
        let (province, location_match, sentiment, is_disaster) = classify::classify(&title);
        let summary = entry.description.as_deref().map(first_paragraph).unwrap_or_default();
        Some(NewsItem {
            id: url.clone(),
            title,
            summary,
            url: Some(url),
            cover: None,
            hot: 0,
            province,
            location_match,
            sentiment,
            is_disaster,
            rank: 0,
            source: Some("IT之家".to_string()),
            published_at: entry.pub_date,
        })
    }).take(5).collect())
}

fn first_paragraph(html: &str) -> String {
    for paragraph in html.split("</p>") {
        let mut plain = String::new();
        let mut in_tag = false;
        for ch in paragraph.chars() {
            match ch {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => plain.push(ch),
                _ => {}
            }
        }
        let normalized = plain.replace("&nbsp;", " ").replace("&mdash;", "—").replace("&hellip;", "…");
        let decoded = quick_xml::escape::unescape(&normalized)
            .map(|text| text.into_owned())
            .unwrap_or(normalized);
        let text = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() >= 20 {
            return text.chars().take(140).collect();
        }
    }
    String::new()
}

pub fn cached_news(state: &AppState) -> Option<FetchResult> {
    let cache = state.news_cache.lock().unwrap().clone()
        .or_else(|| load_news_cache(&state.data_dir))?;
    if cache.items.is_empty() {
        return None;
    }
    let mut items = cache.items;
    use_local_covers(&mut items, &state.data_dir);
    Some(FetchResult {
        ok: false,
        items,
        from_cache: true,
        message: None,
        updated_at: cache.updated_at,
    })
}

fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn local_cover(url: &str, data_dir: &Path) -> Option<String> {
    let path = data_dir.join("covers").join(format!("{:x}.img", fnv1a(url)));
    path.exists().then(|| path.to_string_lossy().into_owned())
}

fn use_local_covers(items: &mut [NewsItem], data_dir: &Path) {
    for it in items.iter_mut().take(10) {
        if let Some(url) = it.cover.as_ref() {
            if url.starts_with("https://") || url.starts_with("http://") {
                if let Some(path) = local_cover(url, data_dir) {
                    it.cover = Some(path);
                }
            }
        }
    }
}

/// 把封面图下载到应用数据目录并返回本地路径；已存在则直接复用
async fn cache_cover(client: &reqwest::Client, url: &str, data_dir: &Path) -> Option<String> {
    if let Some(path) = local_cover(url, data_dir) {
        return Some(path);
    }
    let dir = data_dir.join("covers");
    let path = dir.join(format!("{:x}.img", fnv1a(url)));
    let resp = client
        .get(url)
        .header("User-Agent", UA)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path.to_string_lossy().into_owned())
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn save_news_cache(data_dir: &Path, cache: &NewsCache) {
    let _ = std::fs::create_dir_all(data_dir);
    if let Ok(json) = serde_json::to_string(cache) {
        let _ = std::fs::write(data_dir.join("news_cache.json"), json);
    }
}

fn load_news_cache(data_dir: &Path) -> Option<NewsCache> {
    let text = std::fs::read_to_string(data_dir.join("news_cache.json")).ok()?;
    parse_news_cache(&text)
}

fn parse_news_cache(text: &str) -> Option<NewsCache> {
    serde_json::from_str(&text).ok().or_else(|| {
        serde_json::from_str::<Vec<NewsItem>>(&text).ok().map(|items| NewsCache {
            updated_at: None,
            items,
        })
    })
}

fn to_item(d: &ToutiaoItem) -> Option<NewsItem> {
    let title = d.title.as_ref()?.trim().to_string();
    if title.is_empty() {
        return None;
    }
    let (province, location_match, sentiment, is_disaster) = classify::classify(&title);
    Some(NewsItem {
        id: d
            .cluster_id_str
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| title.clone()),
        summary: title.clone(),
        title,
        url: d.url.clone().filter(|u| !u.is_empty()),
        cover: d
            .image
            .as_ref()
            .and_then(|i| i.url.clone())
            .filter(|u| !u.is_empty()),
        hot: d.hot.unwrap_or(0),
        province,
        location_match,
        sentiment,
        is_disaster,
        rank: 0,
        source: Some("头条热榜".to_string()),
        published_at: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_source_time_and_original_excerpt() {
        let xml = r#"<rss><channel><item><title>新型电池技术发布</title><link>https://www.ithome.com/1/001/001.htm</link><description>&lt;p&gt;研究团队公布了一项新型电池实验结果，并说明了适用场景。&lt;/p&gt;</description><pubDate>Fri, 23 Oct 2026 15:41:12 GMT</pubDate></item></channel></rss>"#;
        let items = parse_ithome(xml).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].source.as_deref(), Some("IT之家"));
        assert_eq!(items[0].published_at.as_deref(), Some("Fri, 23 Oct 2026 15:41:12 GMT"));
        assert!(items[0].summary.contains("研究团队公布了一项新型电池实验结果"));
    }

    #[test]
    fn parses_toutiao_payload() {
        let json = r#"{"data":[{"Title":"四川雅安发生地震","HotValue":123,"ClusterId":"c1","Url":"https://x","Image":{"url":"https://img/x.jpg"}},{"Title":"北京车展今日开幕","HotValue":45,"ClusterId":"c2"}]}"#;
        let parsed: ToutiaoResponse = serde_json::from_str(json).unwrap();
        let items: Vec<NewsItem> = parsed.data.iter().filter_map(to_item).collect();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].province.as_deref(), Some("四川省"));
        assert_eq!(items[0].sentiment, "negative");
        assert!(items[0].is_disaster);
        assert_eq!(items[0].cover.as_deref(), Some("https://img/x.jpg"));
        assert_eq!(items[1].province.as_deref(), Some("北京市"));
    }

    #[test]
    fn reads_previous_cache_format_without_a_timestamp() {
        let json = r#"[{"id":"1","title":"全国高考今日开始","summary":"全国高考今日开始","url":null,"cover":null,"hot":1,"province":null,"sentiment":"neutral","isDisaster":false,"rank":1}]"#;
        let cache = parse_news_cache(json).unwrap();
        assert_eq!(cache.updated_at, None);
        assert_eq!(cache.items[0].location_match, None);
    }
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CITIES, DEFAULT_CITY, cityFromValue, cityLabel, cityValue, findCity } from "./cities";
import { call } from "./ipc";
import { countdownLabel, dailyLine } from "./quotes";
import type { Favorite, FetchResult, NewsItem, Settings, WeatherResult } from "./types";
import mapLayout from "./data/map-layout.json";

interface MarkerData {
  province: string;
  items: NewsItem[];
  x: number;
  y: number;
}

const NS = "http://www.w3.org/2000/svg";
const BACKGROUND = new URL("./assets/map/background.svg", import.meta.url).href;
const HIGHLIGHTS = new URL("./assets/map/highlights.svg", import.meta.url).href;
const PROVINCES = new Map(mapLayout.provinces.map((province) => [province.name, province]));
const NATIONAL = "全国热点";
const REFRESH_MS = 15 * 60 * 1000;
const FEATURE_MS = 18_000;

let windowLabel = "screensaver";
let svg: SVGSVGElement;
let world: SVGGElement;
let provinceHighlight: SVGImageElement;
let tooltip: HTMLElement;
let favPanel: HTMLElement;
let favList: HTMLElement;
let favCount: HTMLElement;
let statusEl: HTMLElement;
let nationalMarker: HTMLElement;
let weatherBox: HTMLElement;
let wxCity: HTMLElement;
let wxTemp: HTMLElement;
let wxCond: HTMLElement;
let wxHilo: HTMLElement;
let wxIcon: HTMLElement;
let wxSearchInput: HTMLInputElement;
let news: NewsItem[] = [];
let favs = new Map<string, Favorite>();
let current: NewsItem | null = null;
let panelMarker: MarkerData | null = null;
let weatherCity = DEFAULT_CITY;
let disasterOnly = false;
let lastStatus = "";
let refreshInFlight = false;
let zoom = { scale: 1, x: 0, y: 0 };
let targetZoom = { ...zoom };
let zoomFrame = 0;
let previousZoomTime = 0;
let base = { w: 1280, h: 800, s: 1, ox: 0, oy: 0 };
const bbox = mapLayout.focus;
let nationalX = 0;
let nationalY = 0;
const markerEls = new Map<string, SVGGElement>();
let featuredItems: NewsItem[] = [];
let featuredIndex = 0;
let featuredTime = "";
let featuredHidden = false;
let contentSettings: Settings | null = null;

function px(lon: number, lat: number): [number, number] {
  return [base.ox + lon * base.s, base.oy - lat * base.s];
}

function setupProjection() {
  const { minLon, maxLon, minLat, maxLat } = bbox;
  const w = svg.clientWidth || 1280;
  const h = svg.clientHeight || 800;
  const s = Math.min(w / (maxLon - minLon), h / (maxLat - minLat)) * 0.82;
  base = {
    w,
    h,
    s,
    ox: (w - (maxLon - minLon) * s) / 2 - minLon * s,
    oy: (h - (maxLat - minLat) * s) / 2 + maxLat * s,
  };
}

function buildBaseMap() {
  world.textContent = "";
  markerEls.clear();
  const { minLon, maxLon, minLat, maxLat } = mapLayout.region;
  const [x, y] = px(minLon, maxLat);
  // Both local images use the same geographic extent as the point layer.
  for (const [id, href] of [["map-background", BACKGROUND], ["province-highlight", HIGHLIGHTS]]) {
    const image = document.createElementNS(NS, "image");
    image.id = id;
    image.setAttribute("href", href);
    image.setAttribute("x", String(x));
    image.setAttribute("y", String(y));
    image.setAttribute("width", String((maxLon - minLon) * base.s));
    image.setAttribute("height", String((maxLat - minLat) * base.s));
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("pointer-events", "none");
    world.appendChild(image);
    if (id === "province-highlight") provinceHighlight = image;
  }
  highlightFeatured();
}

function highlightFeatured() {
  const province = featuredHidden || panelMarker ? null : featuredItems[featuredIndex]?.province;
  const region = province ? PROVINCES.get(province) : null;
  provinceHighlight.style.display = region ? "" : "none";
  if (region) provinceHighlight.setAttribute("href", `${HIGHLIGHTS}#${region.id}`);
  provinceHighlight.dataset.province = region?.name ?? "";
}

function showFeatured() {
  const card = document.querySelector<HTMLButtonElement>("#featured-news")!;
  const item = featuredItems[featuredIndex];
  card.classList.toggle("hidden", !item || featuredHidden || !!panelMarker);
  if (!item) {
    highlightFeatured();
    return;
  }
  card.disabled = !item.url;
  document.querySelector<HTMLElement>("#featured-label")!.textContent =
    `${featuredIndex + 1} / ${featuredItems.length} · ${item.province ?? "全国关注"}`;
  document.querySelector<HTMLElement>("#featured-title")!.textContent = item.title;
  document.querySelector<HTMLElement>("#featured-meta")!.textContent =
    `${item.source ?? "头条热榜"} · ${item.publishedAt ? `发布于 ${formatPublishedTime(item.publishedAt)} · ` : ""}${featuredTime}`;
  highlightFeatured();
}

function advanceFeatured() {
  if (document.hidden || featuredHidden || featuredItems.length < 2 || panelMarker || !favPanel.classList.contains("hidden")) return;
  featuredIndex = (featuredIndex + 1) % featuredItems.length;
  showFeatured();
}

function circle(r: number, fill: string, stroke: string | null = null): SVGCircleElement {
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("r", String(r));
  c.setAttribute("fill", fill);
  if (stroke) c.setAttribute("stroke", stroke);
  return c;
}

function halo(r: number, color: string): SVGCircleElement {
  const c = circle(r, color);
  c.setAttribute("fill-opacity", "0.22");
  return c;
}

function markerEl(m: MarkerData, top5: Set<string>): SVGGElement {
  const g = document.createElementNS(NS, "g");
  g.classList.add("marker");
  g.dataset.province = m.province;
  g.style.transform = `translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)`;
  const agg = m.items.length > 1;
  if (agg) {
    g.appendChild(halo(14, "#facc15"));
    g.appendChild(circle(9, "#facc15"));
    const t = document.createElementNS(NS, "text");
    t.textContent = String(m.items.length);
    t.setAttribute("x", "0");
    t.setAttribute("y", "3.5");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "9");
    t.setAttribute("font-weight", "700");
    t.setAttribute("fill", "#101418");
    g.appendChild(t);
  } else {
    const it = m.items[0];
    if (it.isDisaster) {
      g.appendChild(halo(14, "#ef4444"));
      g.appendChild(circle(9, "#ef4444"));
      g.appendChild(circle(3.5, "#101418"));
    } else {
      const color =
        it.sentiment === "positive" ? "#34d399" : it.sentiment === "negative" ? "#ef4444" : "#facc15";
      g.appendChild(halo(11, color));
      g.appendChild(circle(6, color));
    }
  }
  if (m.items.some((n) => top5.has(n.id))) {
    for (const delay of ["0s", "1.2s"]) {
      const rg = document.createElementNS(NS, "g");
      rg.classList.add("ripple");
      rg.style.animationDelay = delay;
      rg.appendChild(circle(8, "none", "rgba(255,255,255,0.6)"));
      g.appendChild(rg);
    }
  }
  g.addEventListener("click", (e) => {
    e.stopPropagation();
    openPanel(m);
  });
  return g;
}

function buildMarkers() {
  for (const el of markerEls.values()) el.remove();
  markerEls.clear();
  const list = disasterOnly ? news.filter((n) => n.isDisaster) : news;
  const groups = new Map<string, NewsItem[]>();
  for (const it of list) {
    const p = it.province ?? NATIONAL;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(it);
  }
  const top5 = new Set(list.filter((n) => n.rank <= 5).map((n) => n.id));
  for (const [prov, items] of groups) {
    if (prov === NATIONAL) continue;
    const f = PROVINCES.get(prov);
    if (!f) continue;
    const [x, y] = px(f.anchor[0], f.anchor[1]);
    const el = markerEl({ province: prov, items, x, y }, top5);
    world.appendChild(el);
    markerEls.set(prov, el);
  }
  updateNationalHud();
}

function updateNationalHud() {
  const list = disasterOnly ? news.filter((n) => n.isDisaster) : news;
  const items = list.filter((n) => !n.province);
  if (!items.length) {
    nationalMarker.classList.add("hidden");
    return;
  }
  nationalMarker.classList.remove("hidden");
  nationalMarker.querySelector(".nm-count")!.textContent = String(items.length);
}

function layoutHud() {
  const mapBottom = px(bbox.minLon, bbox.minLat)[1];
  nationalX = base.w - 30;
  nationalY = Math.min(mapBottom + 30, base.h - 30);
  nationalMarker.style.left = `${nationalX}px`;
  nationalMarker.style.top = `${nationalY}px`;
}

function starSvg(filled: boolean): SVGSVGElement {
  const s = document.createElementNS(NS, "svg");
  s.classList.add("tt-star");
  s.setAttribute("viewBox", "0 0 16 16");
  const p = document.createElementNS(NS, "path");
  p.setAttribute(
    "d",
    "M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
  );
  p.setAttribute("fill", filled ? "#ffffff" : "none");
  p.setAttribute("stroke", "#e8eef7");
  s.appendChild(p);
  return s;
}

function buildPanelContent(m: MarkerData) {
  tooltip.textContent = "";
  const head = document.createElement("div");
  head.className = "tt-head";
  head.textContent = m.province;
  tooltip.appendChild(head);
  for (const it of m.items) {
    const row = document.createElement("div");
    row.className = "tt-row";
    row.dataset.id = it.id;
    if (it.url) {
      row.classList.add("tt-openable");
      row.addEventListener("click", () => invoke("open_url", { url: it.url }));
    }
    row.addEventListener("mouseenter", () => {
      current = it;
      highlight();
    });
    const dot = document.createElement("span");
    dot.className = "tdot " + (it.isDisaster ? "tdis" : "t" + it.sentiment);
    row.appendChild(dot);
    const body = document.createElement("div");
    body.className = "tt-body";
    const title = document.createElement("div");
    title.className = "tt-title";
    title.textContent = `#${it.rank} ${it.title}`;
    body.appendChild(title);
    if (it.source || it.publishedAt) {
      const source = document.createElement("div");
      source.className = "tt-location";
      source.textContent = `${it.source ?? "头条热榜"}${it.publishedAt ? ` · 发布于 ${formatPublishedTime(it.publishedAt)}` : ""}`;
      body.appendChild(source);
    }
    if (it.summary && it.summary !== it.title) {
      const s = document.createElement("div");
      s.className = "tt-sum";
      s.textContent = it.summary;
      body.appendChild(s);
    }
    row.appendChild(body);
    if (it.cover) {
      const img = document.createElement("img");
      img.className = "tt-cover";
      img.src = coverSrc(it.cover);
      img.onerror = () => img.remove();
      row.appendChild(img);
    }
    const star = starSvg(false);
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(it);
    });
    row.appendChild(star);
    tooltip.appendChild(row);
  }
  const hint = document.createElement("div");
  hint.className = "tt-hint";
  hint.textContent = "点击条目打开网页 · 星号收藏 · 按 F 收藏列表 · 点击其它区域关闭";
  tooltip.appendChild(hint);
}

function coverSrc(p: string): string {
  return /^https?:\/\//.test(p) ? p : convertFileSrc(p);
}

function openPanel(m: MarkerData) {
  if (panelMarker?.province === m.province) {
    closePanel();
    return;
  }
  panelMarker = m;
  current = m.items[0] ?? null;
  showFeatured();
  buildPanelContent(m);
  tooltip.classList.remove("hidden");
  highlight();
  positionPanel();
}

function closePanel() {
  tooltip.classList.add("hidden");
  panelMarker = null;
  current = null;
  showFeatured();
}

function refreshPanel() {
  if (!panelMarker) return;
  const prov = panelMarker.province;
  const items =
    prov === NATIONAL ? news.filter((n) => !n.province) : news.filter((n) => n.province === prov);
  if (!items.length) {
    closePanel();
    return;
  }
  const m: MarkerData =
    prov === NATIONAL
      ? { province: prov, items, x: nationalX, y: nationalY }
      : { province: prov, items, x: panelMarker.x, y: panelMarker.y };
  panelMarker = m;
  buildPanelContent(m);
  highlight();
  positionPanel();
}

function formatUpdateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatPublishedTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? "时间未知" : new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function updateDailyContent(settings: Settings) {
  const quote = document.querySelector<HTMLElement>("#daily-quote")!;
  quote.classList.toggle("hidden", !settings.dailyQuote);
  if (settings.dailyQuote) quote.textContent = dailyLine();

  updateCountdown(settings);
}

function updateCountdown(settings: Settings) {
  const title = document.querySelector<HTMLElement>("#countdown-title-display")!;
  const remaining = document.querySelector<HTMLElement>("#countdown-days")!;
  const label = settings.countdownTitle ? countdownLabel(settings.countdownDate, settings.countdownTime) : null;
  title.textContent = settings.countdownTitle ?? "设置倒计时";
  remaining.classList.toggle("hidden", !label);
  if (label) remaining.textContent = label;
}

function initCountdownEditor() {
  const trigger = document.querySelector<HTMLButtonElement>("#countdown")!;
  const editor = document.querySelector<HTMLElement>("#countdown-editor")!;
  const title = document.querySelector<HTMLInputElement>("#screen-countdown-title")!;
  const date = document.querySelector<HTMLInputElement>("#screen-countdown-date")!;
  const time = document.querySelector<HTMLInputElement>("#screen-countdown-time")!;
  const error = document.querySelector<HTMLElement>("#countdown-editor-error")!;
  const close = () => editor.classList.add("hidden");

  trigger.addEventListener("click", () => {
    if (!editor.classList.contains("hidden")) {
      close();
      return;
    }
    void (async () => {
      try {
        contentSettings = await call<Settings>("get_settings");
      } catch {
        // 使用上次读取的设置。
      }
      title.value = contentSettings?.countdownTitle ?? "";
      date.value = contentSettings?.countdownDate ?? "";
      time.value = contentSettings?.countdownTime ?? "23:59";
      error.classList.add("hidden");
      editor.classList.remove("hidden");
      title.focus();
    })();
  });
  document.querySelector("#countdown-cancel")!.addEventListener("click", close);
  document.querySelector("#countdown-save")!.addEventListener("click", () => {
    void (async () => {
      if (!time.value || !countdownLabel(date.value || null, time.value)) {
        error.textContent = "请输入有效的日期和时间";
        error.classList.remove("hidden");
        return;
      }
      try {
        const settings = await call<Settings>("get_settings");
        settings.countdownTitle = title.value.trim() || null;
        settings.countdownDate = date.value || null;
        settings.countdownTime = time.value;
        contentSettings = await invoke<Settings>("save_settings", { settings });
        updateDailyContent(contentSettings);
        close();
      } catch (e) {
        error.textContent = `保存失败：${String(e)}`;
        error.classList.remove("hidden");
      }
    })();
  });
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!editor.classList.contains("hidden") && !target.closest("#countdown-editor, #countdown")) close();
  });
}

function positionPanel() {
  if (!panelMarker) return;
  const m = panelMarker;
  if (m.province === NATIONAL) {
    // 面板右对齐窗口右缘，宽度限制在地图右缘之外的边距内，避免盖住地图
    const mapRight = px(bbox.maxLon, bbox.minLat)[0];
    const marginW = base.w - 24 - mapRight;
    const maxW = Math.min(360, Math.max(180, marginW));
    tooltip.style.maxWidth = `${maxW}px`;
    const maxH = Math.min(nationalY - 16, Math.round(base.h * 0.62));
    tooltip.style.maxHeight = `${maxH}px`;
    let left = base.w - 12 - tooltip.offsetWidth;
    if (left < 8) left = 8;
    let top = nationalY - 12 - tooltip.offsetHeight;
    if (top < 8) top = 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    return;
  }
  const sx = m.x * zoom.scale + zoom.x;
  const sy = m.y * zoom.scale + zoom.y;
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  let left = sx + 18;
  let top = sy - th / 2;
  if (left + tw > base.w - 8) left = sx - tw - 18;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  if (top + th > base.h - 8) top = base.h - th - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function highlight() {
  for (const row of tooltip.querySelectorAll<HTMLElement>(".tt-row")) {
    const on = row.dataset.id === current?.id;
    row.classList.toggle("active", on);
    const star = row.querySelector(".tt-star path");
    if (star) star.setAttribute("fill", favs.has(row.dataset.id!) ? "#ffffff" : "none");
  }
}

async function loadFavs() {
  const list = await call<Favorite[]>("favorites_list");
  favs = new Map(list.map((f) => [f.id, f]));
  highlight();
  renderFavPanel();
}

async function toggleFav(it: NewsItem) {
  const list = await invoke<Favorite[]>("favorites_toggle", { item: it });
  favs = new Map(list.map((f) => [f.id, f]));
  highlight();
  renderFavPanel();
}

function renderFavPanel() {
  favCount.textContent = String(favs.size);
  favList.textContent = "";
  if (!favs.size) {
    const empty = document.createElement("div");
    empty.className = "fav-empty";
    empty.textContent = "暂无收藏。点击新闻标记展开，悬停条目后按 S 收藏。";
    favList.appendChild(empty);
    return;
  }
  for (const f of favs.values()) {
    const row = document.createElement("div");
    row.className = "fav-row";
    const title = document.createElement("div");
    title.className = "fav-title";
    title.textContent = f.title;
    if (f.url) {
      title.classList.add("fav-open");
      title.addEventListener("click", () => invoke("open_url", { url: f.url }));
    }
    const meta = document.createElement("div");
    meta.className = "fav-meta";
    meta.textContent = [
      f.province ?? "全国",
      f.savedAt ? new Date(Number(f.savedAt) * 1000).toLocaleString("zh-CN", { hour12: false }) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const del = document.createElement("button");
    del.className = "btn mini";
    del.textContent = "移除";
    del.addEventListener("click", () => {
      invoke("favorites_toggle", {
        item: {
          id: f.id,
          title: f.title,
          summary: f.summary,
          url: f.url,
          cover: null,
          hot: 0,
          province: f.province,
          locationMatch: null,
          sentiment: "neutral",
          isDisaster: false,
          rank: 0,
        },
      }).then((list) => {
        favs = new Map((list as Favorite[]).map((x) => [x.id, x]));
        highlight();
        renderFavPanel();
      });
    });
    row.append(title, meta, del);
    favList.appendChild(row);
  }
}

function toggleFavPanel() {
  favPanel.classList.toggle("hidden");
  if (!favPanel.classList.contains("hidden")) renderFavPanel();
}

function weatherIconSvg(cond: string): string {
  const stroke = "currentColor";
  const c = cond || "";
  let body = "";
  if (c.includes("雷")) {
    body = `
      <path d="M8 3h12l-7 11h5l-13 13 5-11H3z" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M6 10l3-4" stroke="${stroke}" stroke-width="1.3"/>`;
  } else if (c.includes("雪")) {
    body = `
      <path d="M7 10a5 5 0 0 1 9.9-1.3A4 4 0 0 1 16 16H6a4 4 0 0 1 1-6z" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>
      <g stroke="${stroke}" stroke-width="1.2" stroke-linecap="round">
        <path d="M10 20v3M10 26v3M8.3 21.5l2.5 1.5M9.3 26.5l2.5-1.5M11.7 21.5l-2.5 1.5M10.7 26.5l-2.5-1.5"/>`;
  } else if (c.includes("雨")) {
    body = `
      <path d="M7 10a5 5 0 0 1 9.9-1.3A4 4 0 0 1 16 16H6a4 4 0 0 1 1-6z" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>
      <g stroke="${stroke}" stroke-width="1.2" stroke-linecap="round">
        <path d="M8 20l-1 3M13 20l-1 3M18 20l-1 3"/>`;
  } else if (c.includes("雾") || c.includes("霾")) {
    body = `
      <path d="M5 11a4 4 0 0 1 7.8-1.5A3.5 3.5 0 0 1 15 16H5a3 3 0 0 1 0-5z" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>
      <g stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"><path d="M8 20h8M8 23h6"/></g>`;
  } else if (c.includes("晴")) {
    body = `
      <circle cx="16" cy="16" r="6" fill="none" stroke="${stroke}" stroke-width="1.4"/>
      <g stroke="${stroke}" stroke-width="1.3" stroke-linecap="round">
        <path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M24.5 7.5l-2 2M9.5 22.5l-2 2"/>`;
  } else {
    body = `
      <path d="M7 10a5 5 0 0 1 9.9-1.3A4 4 0 0 1 16 16H6a4 4 0 0 1 1-6z" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>`;
  }
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none">${body}</svg>`;
}

async function refreshWeather() {
  const selected = cityFromValue(weatherCity);
  wxCity.textContent = cityLabel(selected);
  try {
    const r = await call<WeatherResult>("fetch_weather", { cityId: selected.id }, 15000, 2);
    if (r.ok) {
      wxTemp.textContent = r.temp ? `${Math.round(Number(r.temp))}°` : "--°";
      const freshness = r.fromCache
        ? ` · 缓存${r.updatedAt ? `，${formatUpdateTime(r.updatedAt)} 更新` : "，时间未知"}`
        : "";
      wxCond.textContent = (r.condition ?? "--") + freshness;
      wxHilo.textContent = `高 ${r.high ?? "--"} / 低 ${r.low ?? "--"}`;
      wxIcon.innerHTML = weatherIconSvg(r.condition ?? "");
    } else {
      wxCond.textContent = r.message ?? "获取失败";
    }
  } catch {
    wxCond.textContent = "获取失败";
  }
}

function initWeather() {
  const searchBox = document.querySelector<HTMLElement>("#wx-search")!;
  const error = document.querySelector<HTMLElement>("#wx-search-error")!;
  for (const c of CITIES) {
    const opt = document.createElement("option");
    opt.value = cityLabel(c);
    document.querySelector("#wx-city-options")!.appendChild(opt);
  }
  wxSearchInput.value = cityLabel(cityFromValue(weatherCity));
  document.querySelector("#wx-switch")!.addEventListener("click", (e) => {
    e.stopPropagation();
    searchBox.classList.toggle("hidden");
    if (!searchBox.classList.contains("hidden")) {
      wxSearchInput.value = cityLabel(cityFromValue(weatherCity));
      error.classList.add("hidden");
      wxSearchInput.focus();
      wxSearchInput.select();
    }
  });
  wxSearchInput.addEventListener("change", async () => {
    const city = findCity(wxSearchInput.value);
    if (!city) {
      error.classList.remove("hidden");
      return;
    }
    weatherCity = cityValue(city);
    wxSearchInput.value = cityLabel(city);
    searchBox.classList.add("hidden");
    wxCity.textContent = cityLabel(city);
    try {
      const s = await call<Settings>("get_settings");
      s.weatherCity = weatherCity;
      await invoke("save_settings", { settings: s });
    } catch {
      // 保存失败不阻塞天气刷新
    }
    refreshWeather();
  });
  wxSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      searchBox.classList.add("hidden");
    }
  });
  document.addEventListener("click", (e) => {
    if (!searchBox.classList.contains("hidden") && !(e.target as HTMLElement).closest("#weather")) {
      searchBox.classList.add("hidden");
    }
  });
}

function applyNews(r: FetchResult) {
  news = r.items;
  featuredItems = news;
  featuredIndex = 0;
  featuredTime = r.updatedAt
    ? `${r.fromCache ? "缓存获取于" : "榜单获取于"}${formatUpdateTime(r.updatedAt)}`
    : "获取时间未知";
  showFeatured();
  buildMarkers();
  refreshPanel();
}

async function showCachedNews() {
  try {
    const cached = await call<FetchResult | null>("get_cached_news", undefined, 2000, 3);
    if (!cached?.items.length || refreshInFlight || news.length) return;
    applyNews(cached);
    lastStatus = `显示新闻缓存 · ${cached.updatedAt ? `上次成功获取于 ${formatUpdateTime(cached.updatedAt)}` : "缓存时间未知"}`;
    statusEl.textContent = `${lastStatus} · 正在刷新…`;
  } catch {
    // 无缓存或 IPC 暂未就绪时继续联网获取。
  }
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  statusEl.textContent = news.length ? `${lastStatus} · 正在刷新…` : "正在加载头条热榜…";
  try {
    const r = await call<FetchResult>("fetch_news", undefined, 20000, 2);
    applyNews(r);
    if (r.ok) {
      lastStatus = `免费新闻 · ${news.length} 条 · ${r.updatedAt ? `内容获取于 ${formatUpdateTime(r.updatedAt)}` : "获取时间未知"}`;
    } else {
      lastStatus = news.length
        ? `网络异常，显示新闻缓存 · ${r.updatedAt ? `上次成功获取于 ${formatUpdateTime(r.updatedAt)}` : "缓存时间未知"}`
        : `网络异常：${r.message ?? "未知错误"}（将自动重试）`;
    }
  } catch (e) {
    lastStatus = news.length
      ? `${lastStatus} · 刷新失败：${String(e)}`
      : `新闻加载失败：${String(e)}（将自动重试）`;
  } finally {
    refreshInFlight = false;
  }
  statusEl.textContent = `${lastStatus} · 地点按标题估算，点色为关键词倾向${disasterOnly ? " · 灾害筛选" : ""}`;
}

function toggleDisasterFilter() {
  disasterOnly = !disasterOnly;
  statusEl.textContent = `${lastStatus} · 地点按标题估算，点色为关键词倾向${disasterOnly ? " · 灾害筛选" : ""}`;
  buildMarkers();
  refreshPanel();
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return;
  if (e.key === "Escape") {
    const editor = document.querySelector<HTMLElement>("#countdown-editor")!;
    if (!editor.classList.contains("hidden")) {
      editor.classList.add("hidden");
      return;
    }
    invoke(windowLabel === "preview" ? "close_preview" : "exit_screensaver");
  } else if (e.ctrlKey || e.altKey || e.metaKey ||
      (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]"))) {
    return;
  } else if (e.key === "f" || e.key === "F") {
    toggleFavPanel();
  } else if (e.key === "d" || e.key === "D") {
    toggleDisasterFilter();
  }
}

function renderZoom() {
  svg.style.transform = `matrix(${zoom.scale}, 0, 0, ${zoom.scale}, ${zoom.x}, ${zoom.y})`;
  positionPanel();
}

function animateZoom(time: number) {
  const elapsed = previousZoomTime ? Math.min(time - previousZoomTime, 64) : 16;
  previousZoomTime = time;
  // Time-based easing keeps the response consistent on different refresh rates.
  const blend = 1 - Math.exp(-elapsed / 55);
  zoom.scale += (targetZoom.scale - zoom.scale) * blend;
  zoom.x += (targetZoom.x - zoom.x) * blend;
  zoom.y += (targetZoom.y - zoom.y) * blend;
  const remaining = Math.max(
    Math.abs(targetZoom.scale - zoom.scale) * Math.max(base.w, base.h),
    Math.abs(targetZoom.x - zoom.x), Math.abs(targetZoom.y - zoom.y),
  );
  if (remaining < 0.15) zoom = { ...targetZoom };
  renderZoom();
  if (remaining >= 0.15) {
    zoomFrame = requestAnimationFrame(animateZoom);
  } else {
    zoomFrame = 0;
    previousZoomTime = 0;
  }
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? base.h : 1;
  const delta = Math.max(-240, Math.min(240, e.deltaY * unit));
  if (!delta) return;
  // Reverse immediately rather than finishing an outstanding zoom in the old direction.
  const start = delta * (targetZoom.scale - zoom.scale) > 0 ? zoom.scale : targetZoom.scale;
  const scale = Math.min(4, Math.max(1, start * Math.exp(-delta * 0.0015)));
  if (scale === targetZoom.scale) return;
  const rect = svg.parentElement!.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const ratio = scale / zoom.scale;
  targetZoom = {
    scale,
    x: Math.min(0, Math.max(base.w * (1 - scale), mx - (mx - zoom.x) * ratio)),
    y: Math.min(0, Math.max(base.h * (1 - scale), my - (my - zoom.y) * ratio)),
  };
  if (!zoomFrame) zoomFrame = requestAnimationFrame(animateZoom);
}

export async function initMap(label: string) {
  windowLabel = label;
  svg = document.querySelector("#map")!;
  world = document.createElementNS(NS, "g");
  world.id = "world";
  svg.appendChild(world);
  tooltip = document.querySelector("#tooltip")!;
  favPanel = document.querySelector("#fav-panel")!;
  favList = document.querySelector("#fav-list")!;
  favCount = document.querySelector("#fav-count")!;
  statusEl = document.querySelector("#statusbar")!;
  nationalMarker = document.querySelector("#national-marker")!;
  weatherBox = document.querySelector("#weather")!;
  wxCity = document.querySelector("#wx-city")!;
  wxTemp = document.querySelector("#wx-temp")!;
  wxCond = document.querySelector("#wx-cond")!;
  wxHilo = document.querySelector("#wx-hilo")!;
  wxIcon = document.querySelector("#wx-icon")!;
  wxSearchInput = document.querySelector("#wx-city-search")!;
  const timeEl = document.querySelector<HTMLElement>("#clock-time")!;
  const dateEl = document.querySelector<HTMLElement>("#clock-date")!;
  const week = ["日", "一", "二", "三", "四", "五", "六"];
  const tickClock = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    timeEl.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    dateEl.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week[d.getDay()]}`;
    if (contentSettings) updateCountdown(contentSettings);
  };
  tickClock();
  setInterval(tickClock, 1000);
  initCountdownEditor();
  document.querySelector("#fav-close")!.addEventListener("click", toggleFavPanel);
  document.querySelector("#refresh-btn")!.addEventListener("click", () => {
    refresh();
    refreshWeather();
  });
  const featuredToggle = document.querySelector<HTMLButtonElement>("#featured-toggle")!;
  featuredToggle.addEventListener("click", () => {
    featuredHidden = !featuredHidden;
    featuredToggle.textContent = featuredHidden ? "显示轮播" : "隐藏轮播";
    featuredToggle.setAttribute("aria-pressed", String(featuredHidden));
    showFeatured();
  });
  document.querySelector("#featured-news")!.addEventListener("click", (e) => {
    e.stopPropagation();
    const url = featuredItems[featuredIndex]?.url;
    if (url) void invoke("open_url", { url });
  });
  nationalMarker.addEventListener("click", (e) => {
    e.stopPropagation();
    const items = news.filter((n) => !n.province);
    if (!items.length) return;
    openPanel({ province: NATIONAL, items, x: nationalX, y: nationalY });
  });
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!panelMarker) return;
    if (t.closest("#tooltip") || t.closest(".marker") || t.closest("#national-marker")) return;
    closePanel();
  });
  setupProjection();
  buildBaseMap();
  layoutHud();
  svg.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", () => {
    closePanel();
    cancelAnimationFrame(zoomFrame);
    zoomFrame = 0;
    previousZoomTime = 0;
    setupProjection();
    zoom.x = Math.min(0, Math.max(base.w * (1 - zoom.scale), zoom.x));
    zoom.y = Math.min(0, Math.max(base.h * (1 - zoom.scale), zoom.y));
    targetZoom = { ...zoom };
    buildBaseMap();
    buildMarkers();
    layoutHud();
    renderZoom();
  });
  window.addEventListener("keydown", onKey);
  setInterval(advanceFeatured, FEATURE_MS);
  try {
    const s = await call<Settings>("get_settings");
    contentSettings = s;
    if (s.weatherCity) weatherCity = s.weatherCity;
  } catch {
    // 使用默认城市
  }
  if (contentSettings) updateDailyContent(contentSettings);
  setInterval(() => { if (contentSettings) updateDailyContent(contentSettings); }, 60_000);
  weatherBox.classList.remove("hidden");
  initWeather();
  await loadFavs();
  await listen("screensaver-shown", () => {
    void (async () => {
      try {
        contentSettings = await call<Settings>("get_settings");
        updateDailyContent(contentSettings);
        if (contentSettings.weatherCity) {
          weatherCity = contentSettings.weatherCity;
          wxSearchInput.value = cityLabel(cityFromValue(weatherCity));
        }
      } catch {
        // 保留上次成功读取的设置
      }
      refresh();
      refreshWeather();
    })();
  });
  await showCachedNews();
  await refresh();
  await refreshWeather();
  setInterval(() => {
    refresh();
    refreshWeather();
  }, REFRESH_MS);
}

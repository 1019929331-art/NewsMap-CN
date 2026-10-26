import { invoke } from "@tauri-apps/api/core";
import { CITIES, cityFromValue, cityLabel, cityValue, findCity } from "./cities";
import { call } from "./ipc";
import type { Settings } from "./types";

export async function initSettings() {
  const settings = await call<Settings>("get_settings");
  const enabled = document.querySelector<HTMLInputElement>("#enabled")!;
  const idle = document.querySelector<HTMLInputElement>("#idle-minutes")!;
  const weatherInput = document.querySelector<HTMLInputElement>("#weather-city")!;
  const dailyQuote = document.querySelector<HTMLInputElement>("#show-daily-quote")!;
  const countdownTitle = document.querySelector<HTMLInputElement>("#countdown-title")!;
  const countdownDate = document.querySelector<HTMLInputElement>("#countdown-date")!;
  const countdownTime = document.querySelector<HTMLInputElement>("#countdown-time")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  enabled.checked = settings.enabled;
  idle.value = String(settings.idleMinutes);
  for (const c of CITIES) {
    const opt = document.createElement("option");
    opt.value = cityLabel(c);
    document.querySelector("#weather-city-options")!.appendChild(opt);
  }
  let selectedCity = cityFromValue(settings.weatherCity);
  weatherInput.value = cityLabel(selectedCity);
  dailyQuote.checked = settings.dailyQuote;
  countdownTitle.value = settings.countdownTitle ?? "";
  countdownDate.value = settings.countdownDate ?? "";
  countdownTime.value = settings.countdownTime ?? "23:59";

  const save = async (change: Partial<Settings>) => {
    try {
      const s = { ...await call<Settings>("get_settings"), ...change };
      await invoke<Settings>("save_settings", { settings: s });
      status.textContent = "设置已保存";
    } catch (e) {
      status.textContent = `保存失败：${String(e)}`;
    }
  };

  enabled.addEventListener("change", () => void save({ enabled: enabled.checked }));
  idle.addEventListener("change", () => {
    const minutes = Math.min(60, Math.max(1, Number(idle.value) || 5));
    idle.value = String(minutes);
    void save({ idleMinutes: minutes });
  });
  weatherInput.addEventListener("focus", () => weatherInput.select());
  weatherInput.addEventListener("change", () => {
    const city = findCity(weatherInput.value);
    if (!city) {
      status.textContent = "请选择搜索结果中的城市";
      weatherInput.value = cityLabel(selectedCity);
      return;
    }
    selectedCity = city;
    weatherInput.value = cityLabel(city);
    void save({ weatherCity: cityValue(city) });
  });
  dailyQuote.addEventListener("change", () => void save({ dailyQuote: dailyQuote.checked }));
  countdownTitle.addEventListener("change", () => void save({ countdownTitle: countdownTitle.value.trim() || null }));
  countdownDate.addEventListener("change", () => void save({ countdownDate: countdownDate.value || null }));
  countdownTime.addEventListener("change", () => void save({ countdownTime: countdownTime.value || "23:59" }));
  window.addEventListener("focus", () => {
    void (async () => {
      const latest = await call<Settings>("get_settings");
      enabled.checked = latest.enabled;
      idle.value = String(latest.idleMinutes);
      selectedCity = cityFromValue(latest.weatherCity);
      weatherInput.value = cityLabel(selectedCity);
      dailyQuote.checked = latest.dailyQuote;
      countdownTitle.value = latest.countdownTitle ?? "";
      countdownDate.value = latest.countdownDate ?? "";
      countdownTime.value = latest.countdownTime ?? "23:59";
    })().catch(() => {});
  });
  document.querySelector("#preview")!.addEventListener("click", () => invoke("start_preview"));
  document.querySelector("#run-now")!.addEventListener("click", () => invoke("show_screensaver"));
  status.textContent = "修改后自动保存";
}

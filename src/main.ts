import { getCurrentWindow } from "@tauri-apps/api/window";
import { initMap } from "./map";
import { initSettings } from "./settings";

const label = getCurrentWindow().label;
if (label === "main") {
  document.querySelector("#settings-view")!.classList.remove("hidden");
  initSettings();
} else {
  document.querySelector("#map-view")!.classList.remove("hidden");
  initMap(label);
}

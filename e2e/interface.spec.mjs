import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const mapLayout = JSON.parse(readFileSync(new URL("../src/data/map-layout.json", import.meta.url)));

async function boot(page, label, newsItems = null) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/src/main.ts*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ contentType: "text/javascript", body: `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      mockWindows(${JSON.stringify(label)});
      window.testSettings = { enabled: false, idleMinutes: 5, weatherCity: '深圳|101280601', dailyQuote: true,
        countdownTitle: null, countdownDate: null, countdownTime: null };
      window.testCalls = [];
      let favorites = [];
      const items = ${JSON.stringify(newsItems)} ?? Array.from({ length: 6 }, (_, i) => ({ id: String(i), title: '新闻 ' + (i + 1), summary: '',
        rank: i + 1, province: null, locationMatch: null, sentiment: 'neutral', isDisaster: false,
        url: 'https://example.com/' + i, cover: null, hot: 0, source: '测试来源' }));
      mockIPC((cmd, args) => {
        window.testCalls.push({ cmd, args });
        if (cmd === 'get_settings') return structuredClone(window.testSettings);
        if (cmd === 'save_settings') return window.testSettings = structuredClone(args.settings);
        if (cmd === 'favorites_list') return favorites;
        if (cmd === 'favorites_toggle') {
          favorites = favorites.some(f => f.id === args.item.id) ? favorites.filter(f => f.id !== args.item.id) : [...favorites, args.item];
          return structuredClone(favorites);
        }
        if (cmd === 'fetch_news') return { ok: true, items, fromCache: false, updatedAt: 1792800000 };
        if (cmd === 'fetch_weather') return { ok: true, temp: '20', high: '23', low: '16', condition: '晴' };
        return null;
      }, { shouldMockEvents: true });
      await import('/src/main.ts?application');
    ` });
  });
  await page.goto("/");
  return errors;
}

test("settings fill the window and personalization opens on demand", async ({ page }) => {
  const errors = await boot(page, "main");
  await expect(page.locator("#status")).toHaveText("修改后自动保存");
  expect(await page.locator(".panel").boundingBox()).toMatchObject({ x: 0, y: 0, width: 860, height: 620 });
  await expect(page.locator("#countdown-date")).toBeHidden();
  await page.locator("summary").click();
  await expect(page.locator("#countdown-time")).toBeVisible();
  await page.locator("#weather-city").fill("晋城 · 山西");
  await page.locator("#weather-city").press("Tab");
  await expect.poll(() => page.evaluate(() => window.testSettings.weatherCity)).toBe("晋城|101100601");
  expect(errors).toEqual([]);
});

test("news cards can reopen and the national marker stays clickable", async ({ page }) => {
  const errors = await boot(page, "preview");
  await expect(page.locator("#featured-label")).toContainText("1 / 6");
  await page.locator("#featured-toggle").click();
  await expect(page.locator("#featured-news")).toBeHidden();
  await page.locator("#featured-toggle").click();
  await page.locator("#national-marker").click();
  await expect(page.locator("#tooltip")).toBeVisible();
  await expect(page.locator("#featured-news")).toBeHidden();
  await page.locator("#national-marker").click();
  await expect(page.locator("#featured-news")).toBeVisible();
  await page.locator("#featured-news").click();
  await expect.poll(() => page.evaluate(() => window.testCalls.some((call) => call.cmd === "open_url"))).toBe(true);
  expect(errors).toEqual([]);
});

test("editing and city searches do not trigger F/D shortcuts", async ({ page }) => {
  const errors = await boot(page, "preview");
  await expect(page.locator("#featured-news")).toBeVisible();
  await page.locator("#wx-switch").click();
  await page.locator("#wx-city-search").fill("");
  await page.locator("#wx-city-search").pressSequentially("fd");
  await expect(page.locator("#fav-panel")).toBeHidden();
  await expect(page.locator("#statusbar")).not.toContainText("灾害筛选");
  await page.locator("#wx-city-search").fill("三沙 · 海南");
  await page.locator("#wx-city-search").press("Tab");
  await expect(page.locator("#wx-city")).toHaveText("三沙 · 海南");
  await page.locator("#countdown").click();
  await page.locator("#screen-countdown-title").pressSequentially("Fd");
  await expect(page.locator("#fav-panel")).toBeHidden();
  await page.locator("#screen-countdown-time").fill("18:30");
  await page.locator("#countdown-save").click();
  await expect(page.locator("#countdown-editor")).toBeHidden();
  await expect(page.locator("#countdown-title-display")).toHaveText("Fd");
  expect(await page.evaluate(() => window.testSettings.countdownDate)).toBe(null);
  expect(await page.evaluate(() => window.testSettings.countdownTime)).toBe("18:30");
  await page.locator("#countdown").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#countdown-editor")).toBeHidden();
  expect(await page.evaluate(() => window.testCalls.some((call) => call.cmd === "close_preview"))).toBe(false);
  expect(errors).toEqual([]);
});

const provinceNews = mapLayout.provinces.map((province, i) => ({
  id: `province-${i}`, title: `${province.name}新闻`, summary: "测试新闻摘要", rank: i + 1,
  province: province.name, locationMatch: province.name, sentiment: "neutral", isDisaster: i === 0,
  url: `https://example.com/province/${i}`, cover: null, hot: 0, source: "测试来源",
}));

test("static images render locally with all province markers and a real province highlight", async ({ page }) => {
  const errors = await boot(page, "preview", provinceNews);
  await expect(page.locator(".marker")).toHaveCount(34);
  await expect(page.locator("#province-highlight")).toHaveAttribute("data-province", "北京市");
  const result = await page.evaluate(async () => {
    const render = async (selector) => {
      const image = new Image();
      image.src = document.querySelector(selector).getAttribute("href");
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 2600; canvas.height = 1600;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
      return painted;
    };
    return { background: await render("#map-background"), highlight: await render("#province-highlight") };
  });
  expect(result.background).toBeGreaterThan(100000);
  expect(result.highlight).toBeGreaterThan(100);
  expect(result.highlight).toBeLessThan(10000);
  const anchors = await page.evaluate(async (layout) => {
    const imageUrl = document.querySelector("#province-highlight").getAttribute("href").split("#")[0];
    const canvas = document.createElement("canvas");
    canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    const results = [];
    for (const province of layout.provinces) {
      const image = new Image(); image.src = imageUrl + "#" + province.id;
      await image.decode();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const [lon, lat] = province.anchor;
      const x = Math.round((lon - layout.region.minLon) * layout.width / (layout.region.maxLon - layout.region.minLon));
      const y = Math.round((layout.region.maxLat - lat) * layout.height / (layout.region.maxLat - layout.region.minLat));
      results.push({ name: province.name, painted: ctx.getImageData(x, y, 1, 1).data[3] > 0 });
    }
    return results;
  }, mapLayout);
  expect(anchors.filter(p => !p.painted)).toEqual([]);
  expect(errors).toEqual([]);
});

test("province points open news, favorite and open original links after zoom and resize", async ({ page }) => {
  const errors = await boot(page, "preview", provinceNews);
  await page.locator("#featured-toggle").click();
  const marker = page.locator('.marker[data-province="四川省"]');
  await marker.locator(":scope > circle").last().click({ timeout: 5000 });
  await expect(page.locator(".tt-head")).toHaveText("四川省");
  await page.locator(".tt-star").click();
  await page.keyboard.press("f");
  await expect(page.locator("#fav-list")).toContainText("四川省新闻");
  await page.locator("#fav-close").click();
  await marker.locator(":scope > circle").last().click();
  await page.locator(".tt-row").click();
  await expect.poll(() => page.evaluate(() => window.testCalls.some(c => c.cmd === "open_url" && c.args.url.endsWith("/22")))).toBe(true);
  await page.locator("#map").click({ position: { x: 20, y: 400 } });
  await page.mouse.move(430, 310);
  await page.mouse.wheel(0, -350);
  await expect.poll(() => page.locator("#map").evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1);
  await marker.locator(":scope > circle").last().click({ timeout: 5000 });
  await expect(page.locator(".tt-head")).toHaveText("四川省");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("#tooltip")).toBeHidden();
  await expect(page.locator(".marker")).toHaveCount(34);
  await page.locator('.marker[data-province="广东省"] > circle').last().click({ timeout: 5000 });
  await expect(page.locator(".tt-head")).toHaveText("广东省");
  expect(errors).toEqual([]);
});

test("carousel keeps the province highlight and disaster filtering with static images", async ({ page }) => {
  await page.clock.install();
  const errors = await boot(page, "preview", provinceNews);
  await expect(page.locator("#featured-label")).toContainText("1 / 34");
  await page.clock.fastForward(18_000);
  await expect(page.locator("#featured-label")).toContainText("2 / 34");
  await expect(page.locator("#province-highlight")).toHaveAttribute("data-province", "天津市");
  await page.keyboard.press("d");
  await expect(page.locator(".marker")).toHaveCount(1);
  await expect(page.locator("#statusbar")).toContainText("灾害筛选");
  await page.keyboard.press("d");
  await expect(page.locator(".marker")).toHaveCount(34);
  expect(errors).toEqual([]);
});

async function zoomState(page) {
  return page.locator("#map").evaluate(el => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { scale: m.a, x: m.e, y: m.f };
  });
}

async function wheelAt(page, x, y, deltaY, deltaMode = 0) {
  await page.locator("#map").evaluate((el, input) => {
    const rect = el.parentElement.getBoundingClientRect();
    el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true,
      clientX: rect.left + input.x, clientY: rect.top + input.y,
      deltaY: input.deltaY, deltaMode: input.deltaMode }));
  }, { x, y, deltaY, deltaMode });
}

test("wheel zoom eases between frames and keeps a new cursor anchor fixed", async ({ page }) => {
  await page.clock.install();
  const errors = await boot(page, "preview", provinceNews);
  await page.locator("#featured-toggle").click();
  const before = await zoomState(page);
  await wheelAt(page, 430, 310, -120);
  expect(await zoomState(page)).toEqual(before);
  await page.clock.runFor(32);
  const moving = await zoomState(page);
  expect(moving.scale).toBeGreaterThan(1);
  await page.clock.runFor(600);
  const settled = await zoomState(page);
  expect(settled.scale).toBeGreaterThan(moving.scale);
  expect(settled.scale).toBeLessThan(1.3);
  const anchor = { x: (600 - settled.x) / settled.scale, y: (400 - settled.y) / settled.scale };
  await wheelAt(page, 600, 400, -120);
  for (let frame = 0; frame < 12; frame++) {
    await page.clock.runFor(16);
    const state = await zoomState(page);
    expect(Math.abs(anchor.x * state.scale + state.x - 600)).toBeLessThan(0.1);
    expect(Math.abs(anchor.y * state.scale + state.y - 400)).toBeLessThan(0.1);
  }
  await page.clock.runFor(600);
  expect(errors).toEqual([]);
});

test("zoom reverses promptly, respects limits and returns to the initial full map", async ({ page }) => {
  await page.clock.install();
  const errors = await boot(page, "preview", provinceNews);
  await expect(page.locator(".marker")).toHaveCount(34);
  await wheelAt(page, 430, 310, -240);
  await page.clock.runFor(48);
  const inward = await zoomState(page);
  await wheelAt(page, 430, 310, 120);
  await page.clock.runFor(32);
  expect((await zoomState(page)).scale).toBeLessThan(inward.scale);
  for (let i = 0; i < 12; i++) await wheelAt(page, 430, 310, -240);
  await page.clock.runFor(1000);
  expect((await zoomState(page)).scale).toBe(4);
  for (let i = 0; i < 12; i++) await wheelAt(page, 600, 400, 240);
  await page.clock.runFor(1000);
  expect(await zoomState(page)).toEqual({ scale: 1, x: 0, y: 0 });
  await wheelAt(page, 430, 310, -3, 1);
  await page.clock.runFor(1000);
  expect((await zoomState(page)).scale).toBeGreaterThan(1.05);
  await expect(page.locator(".marker")).toHaveCount(34);
  expect(errors).toEqual([]);
});

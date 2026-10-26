import test from "node:test";
import assert from "node:assert/strict";
import { countdownLabel } from "../src/quotes.ts";
import { CITIES, findCity, cityLabel, cityFromValue, cityValue } from "../src/cities.ts";

const noon = new Date(2026, 9, 24, 12, 0, 0);

test("an omitted date means today, including times already passed", () => {
  assert.equal(countdownLabel(null, "12:01", noon), "还有 1 分钟");
  assert.equal(countdownLabel(null, "11:59", noon), "已过 1 分钟");
  assert.equal(countdownLabel(null, "12:00", noon), "就是现在");
});

test("countdown retains days, hours and minutes across midnight", () => {
  assert.equal(countdownLabel("2026-10-25", "13:02", noon), "还有 1 天 1 小时 2 分钟");
  assert.equal(countdownLabel(null, "00:01", noon), "已过 11 小时 59 分钟");
});

test("old date-only settings default to 23:59", () => {
  assert.equal(countdownLabel("2026-10-24", null, noon), "还有 11 小时 59 分钟");
});

test("invalid calendar dates and times are rejected", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "invalid"]) {
    assert.equal(countdownLabel(date, "12:00", noon), null);
  }
  for (const time of ["24:00", "12:60", "-1:30", "12:00:30", ""]) {
    assert.equal(countdownLabel(null, time, noon), null);
  }
  assert.equal(countdownLabel("2028-02-29", "12:00", new Date(2028, 1, 28, 12)), "还有 1 天");
});

test("partial minutes do not appear as zero", () => {
  assert.equal(countdownLabel(null, "12:01", new Date(2026, 9, 24, 12, 0, 59)), "还有 1 分钟");
});

test("city searches resolve prefecture cities and preserve old settings", () => {
  for (const name of ["晋城", "荆门", "儋州", "三沙", "呼伦贝尔"]) {
    assert.ok(findCity(name), name);
  }
  assert.equal(findCity("深圳市")?.id, "101280601");
  assert.equal(cityLabel(cityFromValue("深圳|101280601")), "深圳 · 广东");
  assert.equal(findCity("不存在的城市"), null);
  assert.equal(findCity("深"), null);
});

test("city identifiers are unique and labeled selections round trip", () => {
  assert.equal(new Set(CITIES.map((city) => city.id)).size, CITIES.length);
  for (const city of CITIES) {
    assert.match(city.id, /^\d{9}$/);
    assert.equal(findCity(cityLabel(city))?.id, city.id);
    assert.equal(cityFromValue(cityValue(city)).id, city.id);
  }
});

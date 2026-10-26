import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const layout = JSON.parse(read("src/data/map-layout.json"));

test("every news-classified province has exactly one static-map point and highlight", () => {
  const classified = Object.keys(JSON.parse(read("src-tauri/src/lexicon.json")).provinces).sort();
  assert.equal(classified.length, 34);
  assert.deepEqual(layout.provinces.map(p => p.name).sort(), classified);
  for (const file of ["background.svg", "highlights.svg"]) {
    const ids = [...read(`src/assets/map/${file}`).matchAll(/id="(CN-[A-Z]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, 34);
    assert.deepEqual(ids.sort(), layout.provinces.map(p => p.id).sort());
  }
  for (const { anchor: [lon, lat] } of layout.provinces) {
    assert.ok(lon >= layout.focus.minLon && lon <= layout.focus.maxLon);
    assert.ok(lat >= layout.focus.minLat && lat <= layout.focus.maxLat);
  }
});

test("shipped map images are self-contained and have pinned public-domain provenance", () => {
  for (const file of ["background.svg", "highlights.svg"]) {
    const svg = read(`src/assets/map/${file}`);
    assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)\s*=/i);
    assert.doesNotMatch(svg, /datav|amap/i);
    assert.match(svg, /Natural Earth/);
  }
  const provenance = JSON.parse(read("licenses/map-sources.json"));
  assert.equal(provenance.revision, layout.revision);
  assert.equal(provenance.sources.length, 4);
  for (const source of provenance.sources) {
    assert.ok(source.url.startsWith(`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${layout.revision}/geojson/`));
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(existsSync(new URL("../src/data/china.geo.json", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/data/neighbors.geo.json", import.meta.url)), false);
});

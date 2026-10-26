"""Generate local SVG images from pinned, public-domain Natural Earth sources.

Optional asset maintenance only; npm build does not need Python or network access.
Usage: python scripts/prepare-map.py [download/cache directory]
Requires Shapely 2.1.2. No DataV geometry is read or reused.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from shapely.geometry import Point, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".release/map-sources"
REVISION = "ca96624a56bd078437bca8184e78163e5039ad19"
FILES = [
    "ne_10m_admin_0_countries_chn.geojson",
    "ne_10m_admin_1_states_provinces.geojson",
    "ne_10m_admin_0_scale_rank_minor_islands.geojson",
    "ne_10m_admin_0_boundary_lines_maritime_indicator_chn.geojson",
]
NAMES = {
    "BJ": "北京市", "TJ": "天津市", "HE": "河北省", "SX": "山西省",
    "NM": "内蒙古自治区", "LN": "辽宁省", "JL": "吉林省", "HL": "黑龙江省",
    "SH": "上海市", "JS": "江苏省", "ZJ": "浙江省", "AH": "安徽省",
    "FJ": "福建省", "JX": "江西省", "SD": "山东省", "HA": "河南省",
    "HB": "湖北省", "HN": "湖南省", "GD": "广东省", "GX": "广西壮族自治区",
    "HI": "海南省", "CQ": "重庆市", "SC": "四川省", "GZ": "贵州省",
    "YN": "云南省", "XZ": "西藏自治区", "SN": "陕西省", "GS": "甘肃省",
    "QH": "青海省", "NX": "宁夏回族自治区", "XJ": "新疆维吾尔自治区",
    "TW": "台湾省", "HK": "香港特别行政区", "MO": "澳门特别行政区",
}
CACHE.mkdir(parents=True, exist_ok=True)
sources = []
datasets = []
manifest = ROOT / "licenses/map-sources.json"
expected = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else None
checksums = {entry["file"]: entry["sha256"] for entry in expected["sources"]} if expected else {}
for filename in FILES:
    url = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{REVISION}/geojson/{filename}"
    cached = CACHE / filename
    if not cached.exists():
        urllib.request.urlretrieve(url, cached)
    raw = cached.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if expected and expected["revision"] == REVISION and checksums.get(filename) != digest:
        raise ValueError(f"Source checksum mismatch: {filename}")
    sources.append({"file": filename, "url": url, "sha256": digest})
    datasets.append(json.loads(raw)["features"])
countries, admin1, minor_islands, maritime = datasets

groups = {key: [] for key in NAMES}
preferred_anchors = {}
for feature in admin1:
    p = feature["properties"]
    code = p["iso_3166_2"]
    if p["adm0_a3"] == "CHN":
        key = "HI" if code == "CN-X01~" else code.removeprefix("CN-")
        if key not in groups:
            raise ValueError(f"Unmapped Chinese province: {code}")
        groups[key].append(shape(feature["geometry"]))
        if code != "CN-X01~":
            preferred_anchors[key] = Point(p["longitude"], p["latitude"])
    elif p["adm0_a3"] == "TWN":
        # Kinmen is geographically part of Fujian; Taiwan is shown as one province.
        groups["FJ" if code == "TW-KIN" else "TW"].append(shape(feature["geometry"]))

china_land = unary_union([shape(f["geometry"]) for f in countries
                          if f["properties"]["ADM0_A3"] in ("CHN", "HKG", "MAC")])
for country_code, key in (("HKG", "HK"), ("MAC", "MO")):
    groups[key] = [shape(f["geometry"]) for f in countries
                   if f["properties"]["ADM0_A3"] == country_code]

for feature in minor_islands:
    p = feature["properties"]
    geometry = shape(feature["geometry"])
    if p["sr_brk_a3"] == "B18":
        # Diaoyu and its affiliated islands; the source's de facto owner is not
        # used as a sovereignty label in this China-POV image.
        groups["TW"].append(geometry)
    elif p["sr_brk_a3"] in ("B46", "B47"):
        groups["HI"].append(geometry)

# Admin-1 polygons use de facto extents. Fill the southwest residual from the
# preassembled China-POV country polygon, without drawing its former internal seam.
southwest = china_land.difference(unary_union([g for items in groups.values() for g in items]))
for area in southwest.geoms:
    if area.area < 0.000001:
        continue
    if not box(78, 26, 98, 34).covers(area):
        raise ValueError(f"Unreviewed China-POV residual: {area.bounds}")
    groups["XZ"].append(area)

provinces = {key: unary_union(items) for key, items in groups.items()}
if any(g.is_empty or not g.is_valid for g in provinces.values()):
    raise ValueError("Missing or invalid province geometry")

# Fixed equirectangular image coordinates, shared with the runtime marker layer.
REGION = {"minLon": 40, "maxLon": 170, "minLat": -10, "maxLat": 70}
FOCUS = {"minLon": 73.5, "maxLon": 135.1, "minLat": 3.3, "maxLat": 54.5}
SCALE = 20
WIDTH, HEIGHT = 2600, 1600


def coordinate(lon, lat):
    return f"{(lon - REGION['minLon']) * SCALE:.3f},{(REGION['maxLat'] - lat) * SCALE:.3f}"


def path(geometry):
    if geometry.is_empty:
        return ""
    if geometry.geom_type == "Polygon":
        return "".join("M" + "L".join(coordinate(*p) for p in ring.coords) + "Z"
                       for ring in [geometry.exterior, *geometry.interiors])
    if geometry.geom_type == "LineString":
        return "M" + "L".join(coordinate(*p) for p in geometry.coords)
    return "".join(path(g) for g in geometry.geoms)


header = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}">'
          '<title>NewsMap CN — Natural Earth, China POV</title>'
          '<desc>Public domain. Made with Natural Earth. Source revision: ' + REVISION + '</desc>')
background = [header]
region = box(REGION["minLon"], REGION["minLat"], REGION["maxLon"], REGION["maxLat"])
background.append('<g fill="#162337" stroke="#34475e" stroke-width="1.2" fill-rule="evenodd">')
for feature in countries:
    if feature["properties"]["ADM0_A3"] in ("CHN", "HKG", "MAC"):
        continue
    geometry = shape(feature["geometry"]).intersection(region)
    if not geometry.is_empty:
        background.append(f'<path d="{path(geometry)}"/>')
background.append('</g><g fill="#30425b" stroke="#8a9db6" stroke-width="1.5" fill-rule="evenodd">')
highlight = [header, '<style>path{display:none}path:target{display:inline}</style>',
             '<g fill="#facc15" fill-opacity=".36" stroke="#facc15" stroke-width="3" fill-rule="evenodd">']
metadata = {"region": REGION, "focus": FOCUS, "width": WIDTH, "height": HEIGHT,
            "revision": REVISION, "provinces": []}
for key, name in NAMES.items():
    geometry = provinces[key]
    # Tiny islands retain their original geometry. No destructive simplification.
    d = path(geometry)
    background.append(f'<path id="CN-{key}" d="{d}"/>')
    highlight.append(f'<path id="CN-{key}" d="{d}"/>')
    largest = max(geometry.geoms, key=lambda g: g.area) if geometry.geom_type == "MultiPolygon" else geometry
    anchor = preferred_anchors.get(key, largest.representative_point())
    if not largest.covers(anchor):
        anchor = largest.representative_point()
    metadata["provinces"].append({"id": f"CN-{key}", "name": name,
                                  "anchor": [round(anchor.x, 6), round(anchor.y, 6)]})
background.append('</g><g fill="none" stroke="#8a9db6" stroke-width="2">')
for feature in maritime:
    background.append(f'<path d="{path(shape(feature["geometry"]))}"/>')
background.append('</g><text x="1450" y="1120" fill="#92a6bf" font-size="18">南海诸岛</text></svg>')
highlight.append('</g></svg>')

# Check named mainland, Taiwan, Hainan and special-administrative-region samples.
samples = {"BJ": (116.4, 39.95), "SH": (121.45, 31.2), "GD": (113.3, 23.15),
           "HI": (109.7, 19.2), "TW": (120.9, 23.8), "HK": (114.16, 22.28),
           "MO": (113.56, 22.19), "XZ": (94.6, 28.0), "XJ": (79.8, 35.1)}
for key, xy in samples.items():
    if provinces[key].distance(Point(xy)) > 0.03:
        raise ValueError(f"Map coverage check failed: {key}")
if len(metadata["provinces"]) != 34 or len(maritime) != 9:
    raise ValueError("Expected 34 provinces and nine source maritime segments")

output = ROOT / "src/assets/map"
output.mkdir(parents=True, exist_ok=True)
(output / "background.svg").write_text("\n".join(background), encoding="utf-8")
(output / "highlights.svg").write_text("\n".join(highlight), encoding="utf-8")
(ROOT / "src/data/map-layout.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / "licenses/map-sources.json").write_text(json.dumps({"revision": REVISION, "sources": sources}, indent=2) + "\n", encoding="utf-8")
print("Generated static SVG background, highlight image and 34 marker anchors; coverage checks passed.")

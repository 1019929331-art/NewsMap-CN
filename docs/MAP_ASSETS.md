# 静态地图与点位

从 0.3.2 开始，地图使用本地静态 SVG 图片，来源为 Natural Earth 公共领域数据；不再读取或分发原先的 DataV 省界 GeoJSON。正常开发、构建和运行均不需要联网获取地图。

## 文件与许可

- `src/assets/map/background.svg`：完整静态底图。
- `src/assets/map/highlights.svg`：省份高亮图片，通过片段 ID 只显示当前省份。
- `src/data/map-layout.json`：固定地理范围和 34 个省级新闻点位；不含省界坐标数组。
- `licenses/Natural-Earth.txt`、`licenses/map-sources.json`：上游许可、固定来源版本及 SHA-256。

[Natural Earth 条款](https://www.naturalearthdata.com/about/terms-of-use/)允许修改、电子分发及商业使用，不要求另行申请。当前源码的 MIT 许可不会改变第三方资料的权利状态。

## 地图表达与核对范围

使用上游 `ne_10m_admin_0_countries_chn` 中国视角，不能直接换成默认国家边界数据。上游关于视角的说明见 [LOCALIZATION.md](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/packages/Natural_Earth_quick_start/LOCALIZATION.md)。

34 个区域与新闻分类中的省份名称一一对应；台湾、香港、澳门按省级区域统一绘制。海南使用海南岛与南海岛屿图层；钓鱼岛及附属岛屿采用小岛图层，海域指示线来自中国视角的九段源线。地图不显示外国数据中的国家标签或行政级别标签。西南区域按中国视角的国家面补齐，消除默认行政区面产生的内部接缝。保留小岛原始几何，不进行会抹掉小岛的抽稀。

生成脚本检查 34 个区域非空、几何有效、主要陆地区域和台港澳样本位置，以及九条源海域线；自动化测试检查点位、底图、独立省份高亮、点击、缩放与窗口变化。它们能够发现数据遗漏、坐标错位和交互回归，不能证明整张地图的每一处地理细节绝对无误。

这是一张 1:1000 万级概化示意底图，不用于测绘或导航，也不是经自然资源主管部门审核的标准地图。第三方数据许可与公开地图审核是不同事项；发布前如需确认是否适用地图审核要求，应向相应主管部门咨询，不能给这张衍生图冒用标准地图审图号。

## 坐标与缩放

两张图片共同使用 2600×1600 的固定画布，对应经度 40–170、纬度 -10–70，使用等距经纬投影。点位和图片共同放入 `#world`，由整个 `#map` 图层平滑缩放。交互面板跟随每一帧的实际变换定位，不会把屏幕像素写死在某个分辨率上。

## 可复现生成

仅当需要维护地图资产时安装 Python 3.10+ 和 Shapely 2.1.2，然后运行：

```powershell
python -m pip install shapely==2.1.2
python scripts/prepare-map.py
```

脚本从固定 Git 提交下载公开数据到忽略的 `.release/map-sources`，生成两张 SVG 和点位目录；不会读取旧 DataV 数据。可将已有下载目录作为第一个参数，离线重生成。保持 `licenses/map-sources.json` 中的数据摘要与源文件一致。

# 第三方内容与依赖

项目自有源码采用 MIT；此许可不会重新授权新闻、图片、天气数据或第三方地图。以下记录可核对的来源，不把“可以免费访问”当作“采用开源许可”。地图核对日期：2026-10-26；其他来源核对日期：2026-10-24。

| 内容 | 项目中的位置 / 用途 | 来源与许可情况 |
| --- | --- | --- |
| 静态地图、独立省份高亮和点位 | `src/assets/map/*.svg`、`src/data/map-layout.json` | [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)，公共领域，明确允许修改、商业使用与电子分发。Made with Natural Earth。使用固定版本的中国视角国家面、省级行政区、小岛及海域指示线图层，重绘为本地 SVG；来源摘要见 `licenses/map-sources.json`，许可记录见 `licenses/Natural-Earth.txt`。0.3.2 已移除原 DataV 省界。核对范围见 `docs/MAP_ASSETS.md`；不声称具有官方审图批准。 |
| 地级行政区划目录 | `src/cities.ts` 中的行政区名称 | [uiwjs/province-city-china](https://github.com/uiwjs/province-city-china)，MIT，Copyright (c) 2019 wabg。完整声明见 `licenses/province-city-china-MIT.txt`。 |
| 气象城市编码 | `src/cities.ts` 中的编码事实映射 | [bubao/weather_id.json](https://gist.github.com/bubao/254e8f4824a88ac1c671e28fc80fc659)；原资料未标注独立许可。三沙、呼伦贝尔所用站点编码经中国天气网页面及接口核对。该目录不是对所有站点实时可用性的承诺。 |
| 头条热榜 | 运行时请求标题、热度、链接及封面 | [今日头条](https://www.toutiao.com/hot-event/hot-board/)，公开网页使用的接口，无 API 密钥；不是本项目提供的官方开发者服务或服务保障。内容与图片权利属于原权利人。 |
| IT之家资讯 | 运行时读取标题、首段、发布时间和原文链接 | [IT之家 RSS](https://www.ithome.com/rss/)，仅做摘要展示及原文跳转；RSS 可访问不意味着内容被 MIT 授权。 |
| 天气 | 运行时请求天气并保存本地缓存 | [中国天气网](https://www.weather.com.cn/)，无需密钥的公开网页数据接口；数据与服务适用来源条款，可能变更或限制访问。州盟等地区使用选定的代表站点。 |
| WebView2Loader.dll | Windows GNU 便携版及安装包的 WebView2 加载器 | Microsoft WebView2 SDK，经 `webview2-com-sys` 构建依赖提供。组件适用 Microsoft WebView2 SDK 许可，见 [Microsoft 使用条款](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。不受本项目 MIT 重新授权。 |

应用依赖 Tauri、tauri-plugin-single-instance、serde、serde_json、reqwest、windows-sys、winreg、url、quick-xml 等 Rust 包，以及 `@tauri-apps/api`。各包保留自身许可；精确版本与传递依赖见 `Cargo.lock` 和 `package-lock.json`。构建工具 Vite、TypeScript、Playwright 等仅用于开发及检查。

发布源码和二进制时一起保留 `LICENSE`、本文件以及 `licenses/`。若需要明确允许整包商业再分发，应先解决上表中未核到独立许可的第三方数据，不应仅凭本项目的 MIT 声明作判断。

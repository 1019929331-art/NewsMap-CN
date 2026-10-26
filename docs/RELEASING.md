# 发布流程

## 环境

Windows 10/11 x64、Node.js 24 LTS（最低 22.18）、Rust stable、WebView2 Runtime。GNU 构建需要匹配的 MinGW 链接器；MSVC 构建需要 Visual Studio C++ Build Tools 与 Windows SDK。安装器使用 NSIS，Tauri 构建时会准备其工具。

## 检查

```powershell
npm ci
npm audit --audit-level=high
npm test
npx playwright install chromium
npm run test:ui
npm run build
cargo +stable-x86_64-pc-windows-gnu test --locked --manifest-path src-tauri/Cargo.toml
```

本机已安装 Edge 时，可用 `$env:NEWSMAP_BROWSER_CHANNEL='msedge'` 运行界面测试。CI 使用 Chromium。MSVC 环境将 Rust 工具链后缀改为 `msvc`。

界面测试通过 Tauri 官方 mock 调用真实前端，覆盖设置折叠、城市搜索、轮播与链接、倒计时编辑和输入快捷键；它不替代真实 Windows 桌面测试。

## 生成文件

保持 package.json、src-tauri/Cargo.toml、tauri.conf.json 的版本一致，并准备 `docs/releases/<版本>.md`。

```powershell
npm run release:prepare
```

默认使用 GNU。MSVC 环境先设置 `$env:NEWSMAP_TARGET='x86_64-pc-windows-msvc'`。输出在 `.release/<版本>/`：安装包、便携 ZIP、源码 ZIP、发布说明、SHA256SUMS.txt。GNU 便携版必须把 WebView2Loader.dll 和 EXE 放在同一目录，不能只复制 EXE。

源码包按白名单收集，不含 node_modules、target、用户设置、缓存、证书或本地构建输出。修改文件清单后需检查压缩包实际内容。`-SkipBuild` 仅适用于刚完成相同版本构建的情况。

## 公开前清单

- [x] 0.3.2 已移除 DataV 省界文件，改为允许修改与再分发的 Natural Earth 公共领域静态图片，并保留来源摘要。
- [ ] 按 MAP_ASSETS.md 复核地图表达和适用的公开地图审核要求；公共领域许可不代表获得审图批准。
- [ ] 核对天气城市编码资料及各数据接口的适用条件，不能把免费访问描述为开源授权。
- [ ] 加入用户提供的截图，参考 images/README.md；确认不泄露个人信息。
- [ ] 在干净的 Windows 用户环境安装、启动、升级、卸载，检查 WebView2 缺失时的安装体验。
- [ ] 实际播放全屏视频和运行游戏，等待超过空闲阈值，检查不抢占前台；测试托盘暂停与恢复。
- [ ] 检查后台启动、收藏保留、断网缓存、链接跳转以及多显示器表现。
- [ ] 核对版本、压缩包内容和 SHA-256；未签名的程序可能出现系统提示，应如实说明。
- [ ] GitHub 上首次运行 CI 并确认通过。本机通过不等于云端工作流已经验证。

不要把仍未核对的项目勾为完成。公开前清单未完成时保留为本地候选版本。

## GitHub

仓库创建后先推送源码并查看 CI。满足公开前清单后，再推送对应 `v<版本>` 标签。release.yml 会构建 Windows MSVC 版本并创建 **Draft + Pre-release**，需人工审阅后发布。工作流本身不会解决地图授权问题。

不要上传 target、node_modules、.release 或用户数据目录，也不要提交签名证书、令牌或个人授权邮件原件。

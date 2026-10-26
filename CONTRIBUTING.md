# 参与开发

请先阅读 README.md、THIRD_PARTY_NOTICES.md 和 docs/RELEASING.md。

问题报告请说明 Windows 版本、应用版本、安装或便携运行方式、复现步骤、预期与实际结果。日志和截图请移除个人信息。

提交修改时保持改动集中，说明原因与验证结果。不要提交用户数据、node_modules、target、安装包、密钥或来源不明的数据文件。依赖更新同步提交锁文件。

提交前运行 `npm test`、`npm run test:ui`、`npm run build` 以及对应 Windows 工具链的 Rust 测试。界面测试准备步骤见发布流程。新增数据源需记录来源、适用条款及缓存策略；新增地图文件需确认再分发许可。

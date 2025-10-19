# GPT Branch Tree Navigation 脚本仓库

本仓库收录 Tampermonkey 用户脚本 **GPT Branch Tree Navigator**，用于在 ChatGPT 对话页面中以树形结构浏览历史分支、快速定位消息并预览节点文本。

## 仓库结构
- `src/gpt-branch-tree-navigator.user.js`：主脚本源码。
- `docs/优化建议.md`：针对当前实现的优化建议与改进方向。

## 使用说明
1. 在浏览器安装 Tampermonkey 或同类用户脚本管理器。
2. 将 `src/gpt-branch-tree-navigator.user.js` 复制到管理器中新建脚本并保存。
3. 打开 ChatGPT 对话页即可看到右侧树形面板。

## 更新日志
- **v1.4.0**：因官方接口策略调整，移除自动切换分支相关逻辑，聚焦于分支浏览、定位与文本预览体验。

## 项目优化
详见 [`docs/优化建议.md`](docs/优化建议.md)。

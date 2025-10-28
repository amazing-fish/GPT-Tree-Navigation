# GPT Branch Tree Navigation 脚本仓库

本仓库收录 Tampermonkey 用户脚本 **GPT Branch Tree Navigator**，用于在 ChatGPT 对话页面中以树形结构浏览历史分支并快速定位消息。

## 最新更新
- **v1.5.0**：优化深层分支的缩进策略与节点排版，长对话也能保持可读宽度，无需频繁左右拖动滚动条。
- **v1.4.2**：树状面板以橙色虚线高亮当前分支，并突出当前对话节点，便于快速辨识所在上下文。
- **v1.4.1**：预览模态支持保留原始换行并渲染基础 Markdown（标题、列表、代码块、强调等），阅读体验更接近对话区展示。

## 仓库结构
- `src/gpt-branch-tree-navigator.user.js`：主脚本源码。
- `docs/优化建议.md`：针对当前实现的优化建议与改进方向。

## 使用说明
1. 在浏览器安装 Tampermonkey 或同类用户脚本管理器。
2. 将 `src/gpt-branch-tree-navigator.user.js` 复制到管理器中新建脚本并保存。
3. 打开 ChatGPT 对话页即可看到右侧树形面板。

## 项目优化
详见 [`docs/优化建议.md`](docs/优化建议.md)。

## 后续目标
- 持续优化多分支内容的展示效果，例如提供兄弟分支摘要、高亮最近更新等能力。

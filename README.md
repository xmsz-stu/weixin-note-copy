# weixin-note-copy

微信笔记图片内嵌工具。把从 Windows 微信笔记复制出的 HTML 粘贴进来，转换本地图片路径，并以富文本 HTML 复制到剪贴板，方便粘贴到腾讯文档等编辑器。

## Development

```sh
npm install
npm run tauri dev
```

## Build Windows x64

GitHub Actions workflow `Build Windows x64` 会在 `windows-latest` 上构建 x64 NSIS 安装包。

手动触发：

1. 打开 GitHub 仓库的 Actions 页面
2. 选择 `Build Windows x64`
3. 点击 `Run workflow`
4. 在构建完成后下载 `weixin-note-copy-windows-x64` artifact

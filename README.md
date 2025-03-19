# Obsidian Ankify 插件

这是一个 Obsidian 插件，可以使用 DeepSeek API 将当前笔记内容转换为 Anki 卡片。

## 功能

- 一键将 Obsidian 笔记内容发送到 DeepSeek AI
- 根据自定义提示词生成 Anki 卡片
- 支持个性化提示词设置
- 便捷的复制功能，方便导入到 Anki

## 效果展示

<img width="1440" alt="image" src="https://github.com/user-attachments/assets/9335edc7-8815-4a97-b294-c171809a2e91" />
<img width="1440" alt="image" src="https://github.com/user-attachments/assets/0acaf79c-4603-4a08-bddd-8d595b7605ba" />
<img width="1440" alt="image" src="https://github.com/user-attachments/assets/c39aafa4-f3c9-4ad2-b74c-f2889146fe22" />
<img width="640" alt="image" src="https://github.com/user-attachments/assets/b75ebbdd-cb6e-47f7-99f8-38d436d83bea" />

## 安装

### 手动安装

1. 从 GitHub 仓库下载最新版本
2. 解压文件到您的 Obsidian 插件文件夹: `{obsidian_vault}/.obsidian/plugins/`
3. 重新加载 Obsidian
4. 在 Obsidian 设置中启用插件

## 使用方法

1. 在 Obsidian 设置中配置您的 DeepSeek API 密钥
2. 自定义您的提示词（可选）
3. 打开一个笔记
4. 点击侧边栏的 Ankify 按钮或者使用命令面板执行"生成 Anki 卡片"命令
5. 在弹出的结果窗口中查看生成的 Anki 卡片内容
6. 点击"复制内容"按钮将生成的内容复制到剪贴板
7. 将内容导入到 Anki（可使用 Anki 的导入功能）

## 设置

- **DeepSeek API 密钥**: 您需要提供一个有效的 DeepSeek API 密钥才能使用此插件
- **自定义提示词**: 自定义生成 Anki 卡片的提示词模板

## 注意事项

- 此插件需要互联网连接以访问 DeepSeek API
- 生成的卡片质量取决于原始笔记内容和提示词设置
- API 调用可能会产生相关费用，请查看 DeepSeek 的定价策略

## 隐私

- 您的笔记内容将被发送到 DeepSeek API 进行处理
- 本插件不会存储您的内容，但请查看 DeepSeek 的隐私政策了解他们如何处理数据

## 许可证

[MIT](LICENSE)

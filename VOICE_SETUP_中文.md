# V5 声音选择

**最方便的选择：用 Microsoft Edge 打开 V5。** 我在这台电脑的 Edge 中查到多款英式英语在线自然语音，包括 **Microsoft Ryan、Sonia、Libby Online (Natural)**。V5 会优先选 Ryan；打开 AI Mode → **Read aloud**，在 **Voice** 中试听、切换即可。此方式不需要另填语音 API Key。[微软的 Edge 在线语音说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/configureonlinetexttospeech)

在线自然语音可能通过浏览器的网络服务处理要朗读的解说文字。如果你想仅用本机声音，在 Voice 里选择不带 **Online** 的声音；这台电脑经典系统语音列表目前只检测到 **Microsoft Zira Desktop**，听感可能比较机械。浏览器实际显示的声音以 V5 下拉框为准。

V5 在新字幕出现时会取消旧语音；暂停、拖动、换视频或关闭 AI Mode 时也会停止朗读。画面描述按约 6 秒节奏取样，让中等长度的句子更容易念完。若网络或云端模型响应较慢，解说本身仍可能落后比赛画面，但不会继续朗读已经被新字幕替换的句子。

如果想给 Windows 另外安装自然语音，可按 **Win + Ctrl + N** 打开“讲述人”设置，找到 **Add natural voices / 添加自然语音**。微软列出的英式英语声音包括 Ryan 与 Sonia。[微软官方安装说明](https://support.microsoft.com/en-us/accessibility/windows/narrator/appendix-a-supported-languages-and-voices) 安装后重新打开浏览器查看 Voice 列表；讲述人可用的声音不保证会由网页语音接口列出。

如果未来需要由应用直接调用更有表现力的云端神经语音，而不是使用浏览器提供的声音，就要单独创建 **Azure AI Speech** 资源并配置它的终结点和密钥；现有 `gpt-4o` 图像模型部署不能代替。[微软 Speech REST 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)

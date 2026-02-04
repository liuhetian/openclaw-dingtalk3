/**
 * Gateway SSE Streaming
 * 直接调用 Gateway 的 /v1/chat/completions 接口实现真流式输出
 */

import type { GatewayStreamOptions } from '../types.js';
import { getGatewayPort } from '../runtime.js';

/**
 * 从 Gateway 获取流式响应
 * 绕过 SDK 的 dispatcher，直接调用 SSE 接口实现真正的流式输出
 * @param options 流式选项
 */
export async function* streamFromGateway(options: GatewayStreamOptions): AsyncGenerator<string, void, unknown> {
  const { userContent, systemPrompts, sessionKey, gatewayAuth, log } = options;
  const gatewayPort = options.gatewayPort || getGatewayPort();
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`;

  // 构建消息
  const messages: Array<{ role: string; content: string }> = [];
  for (const prompt of systemPrompts) {
    messages.push({ role: 'system', content: prompt });
  }
  messages.push({ role: 'user', content: userContent });

  // 构建请求头
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (gatewayAuth) {
    headers['Authorization'] = `Bearer ${gatewayAuth}`;
  }

  log?.info?.(`[Streaming] POST ${gatewayUrl}, session=${sessionKey}, messages=${messages.length}`);

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'default',
      messages,
      stream: true,
      user: sessionKey,
    }),
  });

  log?.info?.(`[Streaming] Response: status=${response.status}, ok=${response.ok}`);

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : '(no body)';
    log?.error?.(`[Streaming] Gateway error: ${errText}`);
    throw new Error(`Gateway error: ${response.status} - ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        log?.info?.(`[Streaming] Stream completed, total chunks: ${chunkCount}`);
        return;
      }

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          chunkCount++;
          if (chunkCount <= 5) {
            log?.info?.(`[Streaming] Chunk #${chunkCount}: "${content.slice(0, 30)}..."`);
          }
          yield content;
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  log?.info?.(`[Streaming] Stream ended, total chunks: ${chunkCount}`);
}

/**
 * 构建媒体处理系统提示词
 * 告诉 AI 如何输出本地文件路径，系统会自动上传
 */
export function buildMediaSystemPrompt(): string {
  return `## 钉钉图片和文件显示规则

你正在钉钉中与用户对话。

### 一、图片显示

显示图片时，直接使用本地文件路径，系统会自动上传处理。

**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**

直接输出本地路径即可，系统会自动上传到钉钉。

### 二、视频分享

**何时分享视频**：
- ✅ 用户明确要求**分享、发送、上传**视频时
- ❌ 仅生成视频保存到本地时，**不需要**分享

**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_VIDEO]{"path":"<本地视频路径>"}[/DINGTALK_VIDEO]
\`\`\`

**支持格式**：mp4（最大 20MB）

### 三、音频分享

**何时分享音频**：
- ✅ 用户明确要求**分享、发送、上传**音频/语音文件时
- ❌ 仅生成音频保存到本地时，**不需要**分享

**音频标记格式**：
当需要分享音频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_AUDIO]{"path":"<本地音频路径>"}[/DINGTALK_AUDIO]
\`\`\`

**支持格式**：ogg、amr（最大 20MB）

### 四、文件分享

**何时分享文件**：
- ✅ 用户明确要求**分享、发送、上传**文件时
- ❌ 仅生成文件保存到本地时，**不需要**分享

**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：

\`\`\`
[DINGTALK_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/DINGTALK_FILE]
\`\`\`

**重要**：文件大小不得超过 20MB，超过限制时告知用户文件过大。`;
}

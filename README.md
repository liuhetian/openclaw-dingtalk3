# DingTalk Channel for OpenClaw

钉钉企业内部机器人 Channel 插件，支持 AI Card 真流式输出。

## 特性

- **AI Card 真流式输出** — Gateway SSE 直连，逐字符更新，流畅打字机效果
- **Stream 模式** — WebSocket 长连接，无需公网 IP 或 Webhook
- **会话管理** — 超时自动新会话、手动命令 (/new, /reset)
- **媒体后处理** — 本地图片/视频/音频/文件自动上传
- **群组配置** — 每个群可独立配置 systemPrompt
- **群成员追踪** — 自动记录群成员信息
- **消息去重** — 防止重复处理
- **Token 自动刷新** — 90分钟阈值自动刷新
- **重试机制** — 指数退避重试
- **TypeScript 严格模式** — 完整类型定义

## 安装

```bash
# 通过远程仓库安装
openclaw plugins install https://github.com/liuhetian/openclaw-dingtalk3.git

# 或本地开发模式
git clone https://github.com/liuhetian/openclaw-dingtalk3.git
cd openclaw-dingtalk3
pnpm install
openclaw plugins install -l .
```

## 配置

### 创建 AI Card 模板（如果使用 card 模式）

如需使用 AI 互动卡片功能，需要在钉钉卡片平台创建模板：

**步骤：**
1. 访问 [钉钉卡片平台](https://open.dingtalk.com/document/development/card)
2. 进入「我的模板」
3. 点击「创建模板」
4. 卡片模板场景选择 **「AI 卡片」**
5. **无需选择预设模板**，直接点击保存
6. 复制模板 ID（格式如：`xxxxx-xxxxx-xxxxx.schema`）
7. 将模板 ID 配置到下面的 `cardTemplateId` 字段

### 配置文件

在 `~/.openclaw/openclaw.json` 中添加：

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "dingxxxxxx",
      "clientSecret": "your-app-secret",
      "robotCode": "dingxxxxxx",
      
      "messageType": "markdown",  // 使用 markdown 模式，或改为 "card" 使用 AI 卡片
      "cardTemplateId": "你的卡片模板ID",  // 仅当 messageType="card" 时需要，需要自己在钉钉卡片平台创建
      
      "sessionTimeout": 1800000,
      "enableSessionCommands": true,
      
      "dmPolicy": "open",
      "groupPolicy": "open",
      
      "enableMediaUpload": true,
      "showThinking": true,
      
      "gatewayToken": "your-gateway-token"
    }
  }
}
```

**重要说明：**
- `cardTemplateId` 不是公共的，需要在你自己的钉钉开放平台创建 AI Card 模板获取
- 如果没有创建模板，请使用 `"messageType": "markdown"` 模式
- Markdown 模式同样支持所有功能，只是没有流式显示效果

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用 |
| `clientId` | string | 必填 | 应用的 AppKey |
| `clientSecret` | string | 必填 | 应用的 AppSecret |
| `robotCode` | string | clientId | 机器人代码 |
| `messageType` | string | `"card"` | 消息类型：card/markdown/text/auto |
| `cardTemplateId` | string | 内置模板 | AI 卡片模板 ID |
| `sessionTimeout` | number | `1800000` | 会话超时(ms)，默认 30 分钟 |
| `enableSessionCommands` | boolean | `true` | 启用会话命令 (/new, /reset) |
| `dmPolicy` | string | `"open"` | 私聊策略：open/pairing/allowlist |
| `allowFrom` | string[] | `[]` | 允许的用户 ID 列表 |
| `groupPolicy` | string | `"open"` | 群聊策略：open/allowlist |
| `groupAllowlist` | string[] | `[]` | 允许的群 ID 列表 |
| `showThinking` | boolean | `true` | 显示"思考中"提示 |
| `enableMediaUpload` | boolean | `true` | 启用媒体自动上传 |
| `longTextMode` | string | `"chunk"` | 长文本处理：chunk/file |
| `longTextThreshold` | number | `4000` | 长文本阈值 |
| `gatewayToken` | string | - | Gateway 认证 token |
| `gatewayPassword` | string | - | Gateway 认证 password |
| `groups` | object | - | 群组独立配置 |

## 会话命令

发送以下命令开启新会话（清空对话历史）：

- `/new`、`/reset`、`/clear`
- `新会话`、`重新开始`、`清空对话`

## 消息类型

### card（AI 互动卡片）**【推荐】**

- 真正的流式更新（逐字符显示）
- Gateway SSE 直连，绕过 SDK 缓冲
- 最佳用户体验

### markdown

- 支持富文本格式
- 使用 SDK 消息管道
- 块状更新

### text

- 纯文本消息
- 最简单可靠

## 主动发送消息

插件注册了 Gateway Method，支持主动发送消息：

```bash
# 发送给用户
openclaw gateway call dingtalk.sendToUser --params '{"userId":"xxx","content":"Hello"}'

# 发送到群
openclaw gateway call dingtalk.sendToGroup --params '{"openConversationId":"xxx","content":"Hello"}'

# 智能发送
openclaw gateway call dingtalk.send --params '{"target":"user:xxx","content":"Hello"}'
```

## 架构

```
用户消息 → DingTalk Stream → 消息路由
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
              Card 模式                 SDK 模式
                    ↓                       ↓
           Gateway SSE 直连          SDK dispatchReply
                    ↓                       ↓
           AI Card 流式更新              缓冲发送
                    ↓                       ↓
                    └───────────┬───────────┘
                                ↓
                          后处理管道
                    (图片/视频/音频/文件)
                                ↓
                            最终输出
```

## License

MIT

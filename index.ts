/**
 * DingTalk Channel Plugin for OpenClaw - Ultimate Edition
 *
 * 集百家之长的钉钉 Channel 插件：
 * - AI Card 真流式输出（Gateway SSE 直连）
 * - 完整的媒体后处理管道
 * - 会话管理（超时、新会话命令）
 * - 群成员追踪和群组独立配置
 * - TypeScript 严格类型
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { dingtalkPlugin } from './src/channel.js';
import { setDingTalkRuntime } from './src/runtime.js';
import { registerGatewayMethods } from './src/gateway/methods.js';

const plugin = {
  id: 'dingtalk',
  name: 'DingTalk Channel (Ultimate)',
  description: 'DingTalk (钉钉) messaging channel via Stream mode with true streaming AI Card',

  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      enabled: { type: 'boolean', default: true },
    },
  },

  register(api: OpenClawPluginApi): void {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });
    registerGatewayMethods(api);
    api.logger?.info('[DingTalk] Ultimate edition plugin registered');
  },
};

export default plugin;
export { dingtalkPlugin };

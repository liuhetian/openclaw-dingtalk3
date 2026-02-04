/**
 * Gateway Methods
 * 注册 Gateway Method 供外部调用
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import type { OpenClawConfig, Logger } from '../types.js';
import { sendToUser, sendToGroup, sendProactive } from '../api/proactive.js';
import { getConfig, probeDingTalk } from './start.js';
import { parseTarget } from '../utils/helpers.js';

/** Gateway Method 参数类型 */
interface GatewayMethodParams {
  userId?: string;
  userIds?: string[];
  openConversationId?: string;
  target?: string;
  content?: string;
  message?: string;
  useAICard?: boolean;
  fallbackToNormal?: boolean;
  accountId?: string;
}

/**
 * 注册 Gateway Methods
 * @param api 插件 API
 */
export function registerGatewayMethods(api: OpenClawPluginApi): void {
  // 状态查询
  api.registerGatewayMethod('dingtalk.status', async ({ respond, cfg }) => {
    const result = await probeDingTalk(cfg as OpenClawConfig);
    respond(true, result);
  });

  // 探测连接
  api.registerGatewayMethod('dingtalk.probe', async ({ respond, cfg }) => {
    const result = await probeDingTalk(cfg as OpenClawConfig);
    respond(result.ok, result);
  });

  /**
   * 发送给用户
   */
  api.registerGatewayMethod('dingtalk.sendToUser', async ({ respond, cfg, params, log }) => {
    const p = (params || {}) as GatewayMethodParams;
    const config = getConfig(cfg as OpenClawConfig, p.accountId);

    if (!config.clientId) {
      return respond(false, { error: 'DingTalk not configured' });
    }

    const targetUserIds = p.userIds || (p.userId ? [p.userId] : []);
    if (targetUserIds.length === 0) {
      return respond(false, { error: 'userId or userIds is required' });
    }

    if (!p.content) {
      return respond(false, { error: 'content is required' });
    }

    const result = await sendToUser(config, targetUserIds, p.content, {
      log: log as Logger,
      useAICard: p.useAICard !== false,
      fallbackToNormal: p.fallbackToNormal !== false,
    });

    respond(result.ok, result);
  });

  /**
   * 发送到群
   */
  api.registerGatewayMethod('dingtalk.sendToGroup', async ({ respond, cfg, params, log }) => {
    const p = (params || {}) as GatewayMethodParams;
    const config = getConfig(cfg as OpenClawConfig, p.accountId);

    if (!config.clientId) {
      return respond(false, { error: 'DingTalk not configured' });
    }

    if (!p.openConversationId) {
      return respond(false, { error: 'openConversationId is required' });
    }

    if (!p.content) {
      return respond(false, { error: 'content is required' });
    }

    const result = await sendToGroup(config, p.openConversationId, p.content, {
      log: log as Logger,
      useAICard: p.useAICard !== false,
      fallbackToNormal: p.fallbackToNormal !== false,
    });

    respond(result.ok, result);
  });

  /**
   * 智能发送
   */
  api.registerGatewayMethod('dingtalk.send', async ({ respond, cfg, params, log }) => {
    const p = (params || {}) as GatewayMethodParams;
    const actualContent = p.content || p.message;
    const config = getConfig(cfg as OpenClawConfig, p.accountId);
    const logger = log as Logger;

    logger?.info?.(`[DingTalk][Gateway] send: params=${JSON.stringify(params)}`);

    if (!config.clientId) {
      return respond(false, { error: 'DingTalk not configured' });
    }

    if (!p.target) {
      return respond(false, { error: 'target is required (format: user:<userId> or group:<openConversationId>)' });
    }

    if (!actualContent) {
      return respond(false, { error: 'content is required' });
    }

    // 解析目标
    const parsed = parseTarget(p.target);
    const sendTarget = parsed.type === 'group' ? { openConversationId: parsed.id } : { userId: parsed.id };

    logger?.info?.(`[DingTalk][Gateway] Parsed target: ${JSON.stringify(sendTarget)}`);

    const result = await sendProactive(config, sendTarget, actualContent, {
      log: logger,
      useAICard: p.useAICard !== false,
      fallbackToNormal: p.fallbackToNormal !== false,
    });

    respond(result.ok, result);
  });

  api.logger?.info('[DingTalk] Gateway methods registered');
}

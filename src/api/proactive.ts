/**
 * Proactive Message API
 * 主动发送消息 API (无需 sessionWebhook)
 */

import type {
  DingTalkConfig,
  AICardTarget,
  SendResult,
  ProactiveSendOptions,
  Logger,
} from '../types.js';
import { sendProactiveMessage } from './message.js';
import { createAICard, finishAICard } from '../card/ai-card.js';
import { getOapiAccessToken } from './token.js';
import { processPostPipeline } from '../post-process/pipeline.js';
import { hasMarkdownFeatures } from '../utils/helpers.js';

/**
 * 主动发送给用户
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置
 * @param userIds 用户 ID (支持单个或数组)
 * @param content 消息内容
 * @param options 发送选项
 */
export async function sendToUser(
  config: DingTalkConfig,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {}
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  if (userIdArray.length === 0) {
    return { ok: false, error: 'userIds cannot be empty', usedAICard: false };
  }

  // AI Card 只支持单个用户
  if (useAICard && userIdArray.length === 1) {
    log?.info?.(`[Proactive] Trying AI Card for user: ${userIdArray[0]}`);
    const cardResult = await sendWithAICard(config, userIdArray[0], content, false, log);

    if (cardResult.ok) {
      return cardResult;
    }

    log?.warn?.(`[Proactive] AI Card failed: ${cardResult.error}`);

    if (!fallbackToNormal) {
      return cardResult;
    }

    log?.info?.('[Proactive] Falling back to normal message');
  }

  // 使用普通消息
  return sendNormalToUser(config, userIdArray, content, options);
}

/**
 * 主动发送到群
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置
 * @param openConversationId 群会话 ID
 * @param content 消息内容
 * @param options 发送选项
 */
export async function sendToGroup(
  config: DingTalkConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {}
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (!openConversationId) {
    return { ok: false, error: 'openConversationId cannot be empty', usedAICard: false };
  }

  if (useAICard) {
    log?.info?.(`[Proactive] Trying AI Card for group: ${openConversationId}`);
    const cardResult = await sendWithAICard(config, openConversationId, content, true, log);

    if (cardResult.ok) {
      return cardResult;
    }

    log?.warn?.(`[Proactive] AI Card failed: ${cardResult.error}`);

    if (!fallbackToNormal) {
      return cardResult;
    }

    log?.info?.('[Proactive] Falling back to normal message');
  }

  // 使用普通消息
  return sendNormalToGroup(config, openConversationId, content, options);
}

/**
 * 智能发送消息
 * @param config 钉钉配置
 * @param target 目标 ({ userId } 或 { openConversationId })
 * @param content 消息内容
 * @param options 发送选项
 */
export async function sendProactive(
  config: DingTalkConfig,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {}
): Promise<SendResult> {
  // 自动检测是否使用 markdown
  if (!options.msgType && hasMarkdownFeatures(content)) {
    options.msgType = 'markdown';
  }

  if (target.userId || target.userIds) {
    const userIds = target.userIds || [target.userId!];
    return sendToUser(config, userIds, content, options);
  }

  if (target.openConversationId) {
    return sendToGroup(config, target.openConversationId, content, options);
  }

  return { ok: false, error: 'Must specify userId, userIds, or openConversationId', usedAICard: false };
}

// ============ 内部实现 ============

/**
 * 使用 AI Card 发送消息
 */
async function sendWithAICard(
  config: DingTalkConfig,
  targetId: string,
  content: string,
  isGroup: boolean,
  log?: Logger
): Promise<SendResult> {
  try {
    // 获取 OAPI Token
    const oapiToken = await getOapiAccessToken(config, log);

    // 创建 AI Card
    const target: AICardTarget = {
      accountId: 'proactive',
      conversationId: targetId,
      isGroup,
      userId: isGroup ? undefined : targetId,
    };

    const card = await createAICard(config, target, log);
    if (!card) {
      return { ok: false, error: 'Failed to create AI Card', usedAICard: false };
    }

    // 后处理
    const processResult = await processPostPipeline(content, {
      config,
      target,
      oapiToken,
      log,
      useProactiveApi: true,
    });

    // 完成 AI Card
    const finalContent = processResult.content.trim();
    if (!finalContent) {
      log?.info?.('[Proactive] Empty content after processing, skipping AI Card');
      return { ok: true, usedAICard: false };
    }

    await finishAICard(card, finalContent, log);

    log?.info?.(`[Proactive] AI Card sent: ${card.cardInstanceId}`);
    return { ok: true, cardInstanceId: card.cardInstanceId, usedAICard: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      usedAICard: false,
    };
  }
}

/**
 * 使用普通消息发送给用户
 */
async function sendNormalToUser(
  config: DingTalkConfig,
  userIds: string[],
  content: string,
  options: ProactiveSendOptions
): Promise<SendResult> {
  try {
    for (const userId of userIds) {
      await sendProactiveMessage(config, userId, content, { log: options.log });
    }
    return { ok: true, usedAICard: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      usedAICard: false,
    };
  }
}

/**
 * 使用普通消息发送到群
 */
async function sendNormalToGroup(
  config: DingTalkConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions
): Promise<SendResult> {
  try {
    await sendProactiveMessage(config, openConversationId, content, { log: options.log });
    return { ok: true, usedAICard: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      usedAICard: false,
    };
  }
}

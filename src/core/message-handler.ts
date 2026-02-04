/**
 * Message Handler
 * 消息处理主逻辑，实现混合模式路由
 */

import type {
  HandleMessageParams,
  DingTalkInboundMessage,
  MessageContent,
  DingTalkConfig,
  AICardTarget,
  Logger,
} from '../types.js';
import { setCurrentLogger } from '../runtime.js';
import { getSessionKey, isNewSessionCommand } from '../session/manager.js';
import { sendMessage, sendThinkingIndicator } from '../api/message.js';
import { getOapiAccessToken } from '../api/token.js';
import { streamAICard, finishAICard } from '../card/ai-card.js';
import { getOrCreateCard, cleanupCardCache } from '../card/card-cache.js';
import { streamFromGateway, buildMediaSystemPrompt } from '../card/streaming.js';
import { processPostPipeline } from '../post-process/pipeline.js';
import { normalizeAllowFrom, isSenderAllowed, maskSensitiveData } from '../utils/helpers.js';
import { noteGroupMember, formatGroupMembers } from '../group/members.js';
import { resolveGroupConfig } from '../group/config.js';

/**
 * 处理钉钉消息的主入口
 * @param params 处理参数
 */
export async function handleDingTalkMessage(params: HandleMessageParams): Promise<void> {
  const { cfg, accountId, data, sessionWebhook, log, dingtalkConfig } = params;

  // 保存日志器引用
  setCurrentLogger(log);

  log?.info?.('[Handler] 收到消息处理请求');
  log?.info?.('[Handler] Full inbound data:', JSON.stringify(maskSensitiveData(data)));

  // 清理过期卡片缓存
  cleanupCardCache();

  // 1. 过滤机器人自身消息
  if (data.senderId === data.chatbotUserId || data.senderStaffId === data.chatbotUserId) {
    log?.info?.('[Handler] 忽略机器人自身消息');
    return;
  }

  // 2. 解析消息内容
  const content = extractMessageContent(data);
  if (!content.text) {
    log?.info?.('[Handler] 空消息内容，跳过处理');
    return;
  }

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';
  const groupId = data.conversationId;
  const to = isDirect ? senderId : groupId;

  log?.info?.(`[Handler] Received: from=${senderName} type=${isDirect ? 'DM' : 'Group'} text="${content.text.slice(0, 50)}..."`);

  // 3. 安全策略检查
  if (isDirect && !checkDmPolicy(dingtalkConfig, senderId, sessionWebhook, log)) {
    return;
  }

  // 4. 处理新会话命令
  if (dingtalkConfig.enableSessionCommands !== false && isNewSessionCommand(content.text)) {
    const sessionTimeout = dingtalkConfig.sessionTimeout || 30 * 60 * 1000;
    getSessionKey(senderId, true, sessionTimeout, log);
    await sendMessage(dingtalkConfig, to, '✨ 已开启新会话，之前的对话已清空。', {
      sessionWebhook,
      atUserId: isDirect ? null : senderId,
      log,
    });
    log?.info?.(`[Handler] New session requested by ${senderId}`);
    return;
  }

  // 5. 获取会话上下文
  const sessionTimeout = dingtalkConfig.sessionTimeout || 30 * 60 * 1000;
  const { sessionKey, isNew } = getSessionKey(senderId, false, sessionTimeout, log);
  log?.info?.(`[Handler] Session: key=${sessionKey}, isNew=${isNew}`);

  // 6. 群组特性处理
  if (!isDirect) {
    noteGroupMember(groupId, senderId, senderName, log);
  }

  // 7. 根据消息类型路由
  const messageType = dingtalkConfig.messageType || 'card';

  if (messageType === 'card') {
    await handleWithCardMode({
      cfg,
      accountId,
      data,
      sessionWebhook,
      log,
      dingtalkConfig,
      content,
      senderId,
      senderName,
      groupId,
      isDirect,
      to,
      sessionKey,
    });
  } else {
    await handleWithSDKMode({
      cfg,
      accountId,
      data,
      sessionWebhook,
      log,
      dingtalkConfig,
      content,
      senderId,
      senderName,
      groupId,
      isDirect,
      to,
      sessionKey,
    });
  }
}

/**
 * Card 模式处理：直接调用 Gateway SSE，真流式更新 AI Card
 */
async function handleWithCardMode(ctx: MessageHandlerContext): Promise<void> {
  const { dingtalkConfig, log, accountId, content, senderId, isDirect, to, sessionKey, groupId } = ctx;

  // 创建 AI Card
  const target: AICardTarget = {
    accountId,
    conversationId: to,
    isGroup: !isDirect,
    userId: isDirect ? senderId : undefined,
  };

  const card = await getOrCreateCard(dingtalkConfig, target, log);

  if (!card) {
    log?.warn?.('[Handler] AI Card creation failed, falling back to SDK mode');
    await handleWithSDKMode(ctx);
    return;
  }

  log?.info?.(`[Handler] AI Card created: ${card.cardInstanceId}`);

  // 构建系统提示词
  const systemPrompts: string[] = [];
  if (dingtalkConfig.enableMediaUpload !== false) {
    systemPrompts.push(buildMediaSystemPrompt());
  }

  // 群组系统提示词
  if (!isDirect) {
    const groupConfig = resolveGroupConfig(dingtalkConfig, groupId);
    if (groupConfig?.systemPrompt) {
      systemPrompts.push(groupConfig.systemPrompt);
    }
    const groupMembers = formatGroupMembers(groupId);
    if (groupMembers) {
      systemPrompts.push(`当前群成员: ${groupMembers}`);
    }
  }

  // Gateway 认证
  const gatewayAuth = dingtalkConfig.gatewayToken || dingtalkConfig.gatewayPassword || '';

  // 获取 OAPI Token (用于后处理)
  const oapiToken = dingtalkConfig.enableMediaUpload !== false ? await getOapiAccessToken(dingtalkConfig, log) : null;

  let accumulated = '';
  let lastUpdateTime = 0;
  const updateInterval = 300; // 流式更新最小间隔 (ms)

  try {
    log?.info?.('[Handler] Starting Gateway SSE streaming...');

    for await (const chunk of streamFromGateway({
      userContent: content.text,
      systemPrompts,
      sessionKey,
      gatewayAuth,
      log,
    })) {
      accumulated += chunk;

      // 节流更新
      const now = Date.now();
      if (now - lastUpdateTime >= updateInterval) {
        // 实时清理媒体标记 (避免用户看到)
        const displayContent = cleanMediaMarkers(accumulated);
        await streamAICard(card, displayContent, false, log);
        lastUpdateTime = now;
      }
    }

    log?.info?.(`[Handler] SSE streaming completed, ${accumulated.length} chars`);

    // 后处理
    const processResult = await processPostPipeline(accumulated, {
      config: dingtalkConfig,
      target,
      oapiToken,
      log,
      useProactiveApi: true,
    });

    // 完成 AI Card
    const finalContent = processResult.content.trim() || '✅ 处理完成';
    await finishAICard(card, finalContent, log);
    log?.info?.(`[Handler] AI Card finished, ${finalContent.length} chars`);
  } catch (error) {
    log?.error?.(`[Handler] Card mode error: ${error instanceof Error ? error.message : error}`);
    accumulated += `\n\n⚠️ 响应中断: ${error instanceof Error ? error.message : error}`;
    try {
      await finishAICard(card, accumulated, log);
    } catch (finishError) {
      log?.error?.(`[Handler] Finish card error: ${finishError instanceof Error ? finishError.message : finishError}`);
    }
  }
}

/**
 * SDK 模式处理：使用 SDK 消息管道
 */
async function handleWithSDKMode(ctx: MessageHandlerContext): Promise<void> {
  const { dingtalkConfig, sessionWebhook, log, content, senderId, isDirect, to, sessionKey, groupId } = ctx;

  // 显示思考中提示
  if (dingtalkConfig.showThinking !== false) {
    await sendThinkingIndicator(dingtalkConfig, sessionWebhook, log);
  }

  // 构建系统提示词
  const systemPrompts: string[] = [];
  if (dingtalkConfig.enableMediaUpload !== false) {
    systemPrompts.push(buildMediaSystemPrompt());
  }

  // 群组配置
  if (!isDirect) {
    const groupConfig = resolveGroupConfig(dingtalkConfig, groupId);
    if (groupConfig?.systemPrompt) {
      systemPrompts.push(groupConfig.systemPrompt);
    }
  }

  // Gateway 认证
  const gatewayAuth = dingtalkConfig.gatewayToken || dingtalkConfig.gatewayPassword || '';

  // OAPI Token
  const oapiToken = dingtalkConfig.enableMediaUpload !== false ? await getOapiAccessToken(dingtalkConfig, log) : null;

  let fullResponse = '';

  try {
    for await (const chunk of streamFromGateway({
      userContent: content.text,
      systemPrompts,
      sessionKey,
      gatewayAuth,
      log,
    })) {
      fullResponse += chunk;
    }

    // 后处理
    const target: AICardTarget = {
      accountId: ctx.accountId,
      conversationId: to,
      isGroup: !isDirect,
    };

    const processResult = await processPostPipeline(fullResponse, {
      config: dingtalkConfig,
      target,
      oapiToken,
      log,
      useProactiveApi: false,
    });

    // 发送消息
    await sendMessage(dingtalkConfig, to, processResult.content || '（无响应）', {
      sessionWebhook,
      atUserId: isDirect ? null : senderId,
      useMarkdown: true,
      log,
    });

    log?.info?.(`[Handler] SDK mode reply sent, ${processResult.content.length} chars`);
  } catch (error) {
    log?.error?.(`[Handler] SDK mode error: ${error instanceof Error ? error.message : error}`);
    await sendMessage(dingtalkConfig, to, `抱歉，处理请求时出错: ${error instanceof Error ? error.message : error}`, {
      sessionWebhook,
      atUserId: isDirect ? null : senderId,
      log,
    });
  }
}

// ============ 辅助函数 ============

interface MessageHandlerContext {
  cfg: HandleMessageParams['cfg'];
  accountId: string;
  data: DingTalkInboundMessage;
  sessionWebhook: string;
  log?: Logger;
  dingtalkConfig: DingTalkConfig;
  content: MessageContent;
  senderId: string;
  senderName: string;
  groupId: string;
  isDirect: boolean;
  to: string;
  sessionKey: string;
}

/**
 * 解析消息内容
 */
function extractMessageContent(data: DingTalkInboundMessage): MessageContent {
  const msgtype = data.msgtype || 'text';

  switch (msgtype) {
    case 'text':
      return { text: data.text?.content?.trim() || '', messageType: 'text' };

    case 'richText': {
      const parts = data.content?.richText || [];
      let text = '';
      for (const part of parts) {
        if (part.type === 'text' && part.text) text += part.text;
        if (part.type === 'at' && part.atName) text += `@${part.atName} `;
      }
      return { text: text.trim() || '[富文本消息]', messageType: 'richText' };
    }

    case 'picture':
      return { text: '[图片]', mediaPath: data.content?.downloadCode, mediaType: 'image', messageType: 'picture' };

    case 'audio':
      return {
        text: data.content?.recognition || '[语音消息]',
        mediaPath: data.content?.downloadCode,
        mediaType: 'audio',
        messageType: 'audio',
      };

    case 'video':
      return { text: '[视频]', mediaPath: data.content?.downloadCode, mediaType: 'video', messageType: 'video' };

    case 'file':
      return {
        text: `[文件: ${data.content?.fileName || '文件'}]`,
        mediaPath: data.content?.downloadCode,
        mediaType: 'file',
        messageType: 'file',
      };

    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
  }
}

/**
 * 检查私聊策略
 */
function checkDmPolicy(
  config: DingTalkConfig,
  senderId: string,
  sessionWebhook: string,
  log?: Logger
): boolean {
  const dmPolicy = config.dmPolicy || 'open';

  if (dmPolicy === 'open') return true;

  if (dmPolicy === 'allowlist') {
    const normalized = normalizeAllowFrom(config.allowFrom);
    if (!isSenderAllowed({ allow: normalized, senderId })) {
      log?.debug?.(`[Handler] DM blocked: ${senderId} not in allowlist`);
      // 发送拒绝消息
      sendMessage(
        config,
        senderId,
        `⛔ 访问受限\n\n您的用户ID：\`${senderId}\`\n\n请联系管理员将此ID添加到允许列表中。`,
        { sessionWebhook, log }
      ).catch(() => {});
      return false;
    }
  }

  return true;
}

/**
 * 清理媒体标记 (用于流式显示时隐藏)
 */
function cleanMediaMarkers(content: string): string {
  return content
    .replace(/\[DINGTALK_FILE\].*?\[\/DINGTALK_FILE\]/g, '')
    .replace(/\[DINGTALK_VIDEO\].*?\[\/DINGTALK_VIDEO\]/g, '')
    .replace(/\[DINGTALK_AUDIO\].*?\[\/DINGTALK_AUDIO\]/g, '')
    .trim();
}

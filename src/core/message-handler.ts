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
import { normalizeAllowFrom, isSenderAllowed } from '../utils/helpers.js';
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
  
  // 调试：专门打印 text 字段的完整内容（这是引用消息的关键）
  const textAny = data.text as any;
  if (textAny) {
    // 分开打印避免日志被截断
    log?.info?.(`[Handler] TEXT.content: ${textAny.content}`);
    log?.info?.(`[Handler] TEXT.isReplyMsg: ${textAny.isReplyMsg}`);
    if (textAny.repliedMsg) {
      // 打印 repliedMsg 的键
      const repliedMsgKeys = Object.keys(textAny.repliedMsg);
      log?.info?.(`[Handler] TEXT.repliedMsg 的键: [${repliedMsgKeys.join(', ')}]`);
      // 分开打印每个键的值
      for (const key of repliedMsgKeys) {
        const val = textAny.repliedMsg[key];
        const valStr = typeof val === 'object' ? JSON.stringify(val).substring(0, 300) : String(val);
        log?.info?.(`[Handler] TEXT.repliedMsg.${key}: ${valStr}`);
      }
    }
  }

  // 清理过期卡片缓存
  cleanupCardCache();

  // 1. 过滤机器人自身消息
  if (data.senderId === data.chatbotUserId || data.senderStaffId === data.chatbotUserId) {
    log?.info?.('[Handler] 忽略机器人自身消息');
    return;
  }

  // 2. 解析消息内容
  const content = extractMessageContent(data, log);
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
function extractMessageContent(data: DingTalkInboundMessage, log?: Logger): MessageContent {
  const msgtype = data.msgtype || 'text';

  let baseText = '';
  let quotedPrefix = '';

  // 调试：打印完整的 text 对象结构
  if (data.text) {
    log?.info?.(`[Handler] text 对象完整结构: ${JSON.stringify(data.text)}`);
  }

  // 1. 先处理引用消息 - 使用 as any 绕过类型检查，因为钉钉返回的数据可能有额外字段
  const textObj = data.text as any;
  const dataAny = data as any;
  
  // 检查多个可能的引用消息位置
  const hasReplyInText = textObj?.isReplyMsg === true;
  const hasReplyAtTop = dataAny?.isReplyMsg === true;
  const hasRepliedMsgInText = !!textObj?.repliedMsg;
  const hasRepliedMsgAtTop = !!dataAny?.repliedMsg;
  
  log?.info?.(`[Handler] 引用消息检测: text.isReplyMsg=${hasReplyInText}, top.isReplyMsg=${hasReplyAtTop}, text.repliedMsg=${hasRepliedMsgInText}, top.repliedMsg=${hasRepliedMsgAtTop}`);
  
  if (hasReplyInText || hasReplyAtTop || hasRepliedMsgInText || hasRepliedMsgAtTop) {
    log?.info?.('[Handler] 检测到引用回复消息');
    quotedPrefix = extractQuotedContent(data, log);
  }

  // 2. 根据消息类型提取主体内容
  switch (msgtype) {
    case 'text':
      baseText = data.text?.content?.trim() || '';
      return { 
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText, 
        messageType: 'text' 
      };

    case 'richText': {
      const parts = data.content?.richText || [];
      let text = '';
      for (const part of parts) {
        if (part.type === 'text' && part.text) text += part.text;
        if (part.type === 'at' && part.atName) text += `@${part.atName} `;
      }
      baseText = text.trim() || '[富文本消息]';
      return { 
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText, 
        messageType: 'richText' 
      };
    }

    case 'chatRecord': {
      // 处理转发的聊天记录合集
      const chatRecordText = extractChatRecord(data, log);
      return { text: chatRecordText, messageType: 'chatRecord' };
    }

    case 'picture':
      baseText = '[图片]';
      return { 
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText, 
        mediaPath: data.content?.downloadCode, 
        mediaType: 'image', 
        messageType: 'picture' 
      };

    case 'audio':
      baseText = data.content?.recognition || '[语音消息]';
      return {
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText,
        mediaPath: data.content?.downloadCode,
        mediaType: 'audio',
        messageType: 'audio',
      };

    case 'video':
      baseText = '[视频]';
      return { 
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText, 
        mediaPath: data.content?.downloadCode, 
        mediaType: 'video', 
        messageType: 'video' 
      };

    case 'file':
      baseText = `[文件: ${data.content?.fileName || '文件'}]`;
      return {
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText,
        mediaPath: data.content?.downloadCode,
        mediaType: 'file',
        messageType: 'file',
      };

    default:
      baseText = data.text?.content?.trim() || `[${msgtype}消息]`;
      return { 
        text: quotedPrefix ? `${quotedPrefix}\n${baseText}` : baseText, 
        messageType: msgtype 
      };
  }
}

/**
 * 提取引用消息内容
 */
function extractQuotedContent(data: DingTalkInboundMessage, log?: Logger): string {
  try {
    // 使用 as any 绕过类型检查
    const textObj = data.text as any;
    const dataAny = data as any;
    
    // 尝试从多个位置获取 repliedMsg
    const repliedMsg = textObj?.repliedMsg || dataAny?.repliedMsg;
    
    // 打印 repliedMsg 的所有键，帮助调试
    if (repliedMsg) {
      const keys = Object.keys(repliedMsg);
      log?.info?.(`[Handler] repliedMsg 的键: ${keys.join(', ')}`);
      log?.info?.(`[Handler] repliedMsg 完整结构: ${JSON.stringify(repliedMsg).substring(0, 500)}`);
    }
    
    if (!repliedMsg) {
      log?.info?.('[Handler] 引用消息标记存在但无 repliedMsg 字段 (已检查 text.repliedMsg 和顶层 repliedMsg)');
      return '';
    }

    let quotedContent = '';

    // 方式1: repliedMsg.content 存在
    if (repliedMsg.content) {
      const content = repliedMsg.content;
      log?.info?.(`[Handler] repliedMsg.content 类型: ${typeof content}`);

      // richText 格式：数组包含文本和图片
      if (typeof content === 'object' && content.richText && Array.isArray(content.richText)) {
        const parts: string[] = [];
        for (const item of content.richText) {
          if (item.msgType === 'text' && item.content) {
            parts.push(item.content);
          } else if (item.msgType === 'picture') {
            parts.push('[图片]');
          }
        }
        quotedContent = parts.join('');
      }
      // text 字段
      else if (typeof content === 'object' && content.text) {
        quotedContent = content.text;
      }
      // 字符串格式
      else if (typeof content === 'string') {
        quotedContent = content;
      }
    }
    
    // 方式2: repliedMsg.text 直接存在（另一种可能的结构）
    if (!quotedContent && repliedMsg.text) {
      log?.info?.(`[Handler] 尝试 repliedMsg.text: ${JSON.stringify(repliedMsg.text).substring(0, 200)}`);
      if (typeof repliedMsg.text === 'string') {
        quotedContent = repliedMsg.text;
      } else if (repliedMsg.text.content) {
        quotedContent = repliedMsg.text.content;
      }
    }
    
    // 方式3: repliedMsg.richText 直接存在
    if (!quotedContent && repliedMsg.richText && Array.isArray(repliedMsg.richText)) {
      log?.info?.(`[Handler] 尝试 repliedMsg.richText`);
      const parts: string[] = [];
      for (const item of repliedMsg.richText) {
        if (item.msgType === 'text' && item.content) {
          parts.push(item.content);
        } else if (item.type === 'text' && item.text) {
          parts.push(item.text);
        } else if (item.msgType === 'picture' || item.type === 'picture') {
          parts.push('[图片]');
        }
      }
      quotedContent = parts.join('');
    }
    
    // 方式4: repliedMsg 直接是字符串
    if (!quotedContent && typeof repliedMsg === 'string') {
      quotedContent = repliedMsg;
    }
    
    // 方式5: repliedMsg.body 或其他可能的字段
    if (!quotedContent) {
      const possibleFields = ['body', 'message', 'msg', 'value', 'data'];
      for (const field of possibleFields) {
        if (repliedMsg[field]) {
          log?.info?.(`[Handler] 尝试 repliedMsg.${field}`);
          if (typeof repliedMsg[field] === 'string') {
            quotedContent = repliedMsg[field];
            break;
          }
        }
      }
    }

    if (quotedContent) {
      log?.info?.(`[Handler] 提取引用内容成功: ${quotedContent.slice(0, 50)}...`);
      return `[引用回复: "${quotedContent.trim()}"]`;
    }

    log?.info?.('[Handler] 引用消息存在但无法提取内容');
    return '';
  } catch (err) {
    log?.warn?.(`[Handler] 提取引用消息失败: ${err}`);
    return '';
  }
}

/**
 * 提取聊天记录合集 (转发消息)
 */
function extractChatRecord(data: DingTalkInboundMessage, log?: Logger): string {
  try {
    // 尝试多种方式获取 chatRecord
    const chatRecordContent = data.content || (data as any).chatRecord;
    log?.info?.(`[Handler] chatRecord content 结构: ${JSON.stringify(chatRecordContent)}`);
    
    const chatRecordStr = chatRecordContent?.chatRecord;
    
    if (!chatRecordStr || typeof chatRecordStr !== 'string') {
      log?.info?.('[Handler] chatRecord 消息无有效内容 (chatRecord字段不是字符串)');
      return '[聊天记录合集]';
    }

    const records = JSON.parse(chatRecordStr) as Array<{
      senderId?: string;
      senderStaffId?: string;
      senderNick?: string;
      msgType?: string;
      content?: string;
      downloadCode?: string;
      createAt?: number;
    }>;

    if (!Array.isArray(records) || records.length === 0) {
      log?.info?.('[Handler] chatRecord 解析为空数组');
      return '[聊天记录合集]';
    }

    log?.info?.(`[Handler] chatRecord 包含 ${records.length} 条消息`);

    // 格式化每条记录
    const formattedRecords = records.map((record, idx) => {
      // 获取发送者名称
      const sender = record.senderNick || '未知';

      // 根据消息类型处理内容
      let msgContent: string;
      switch (record.msgType) {
        case 'text':
          msgContent = record.content || '[空消息]';
          break;
        case 'picture':
        case 'image':
          msgContent = '[图片]';
          break;
        case 'video':
          msgContent = '[视频]';
          break;
        case 'file':
          msgContent = '[文件]';
          break;
        case 'voice':
        case 'audio':
          msgContent = '[语音]';
          break;
        case 'richText':
          msgContent = record.content || '[富文本消息]';
          break;
        case 'markdown':
          msgContent = record.content || '[Markdown消息]';
          break;
        default:
          msgContent = record.content || `[${record.msgType || '未知'}消息]`;
      }

      // 格式化时间
      const time = record.createAt ? new Date(record.createAt).toLocaleString('zh-CN') : '';
      return `[${idx + 1}] ${sender}${time ? ` (${time})` : ''}: ${msgContent}`;
    });

    const result = `[聊天记录合集 - ${records.length}条消息]\n${formattedRecords.join('\n')}`;
    log?.info?.(`[Handler] chatRecord 格式化完成`);
    return result;
  } catch (err) {
    log?.warn?.(`[Handler] 解析 chatRecord 失败: ${err}`);
    return '[聊天记录合集]';
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

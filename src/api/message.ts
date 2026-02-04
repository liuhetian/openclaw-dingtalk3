/**
 * Message API
 * 消息发送相关 API
 */

import axios from 'axios';
import type {
  DingTalkConfig,
  SendMessageOptions,
  ProactiveMessagePayload,
  SessionWebhookResponse,
  Logger,
} from '../types.js';
import { getAccessToken } from './token.js';
import { hasMarkdownFeatures, extractTitle } from '../utils/helpers.js';

const DINGTALK_API = 'https://api.dingtalk.com';

/**
 * 通过 Session Webhook 发送消息
 * @param config 钉钉配置
 * @param sessionWebhook Session Webhook URL
 * @param text 消息文本
 * @param options 发送选项
 */
export async function sendBySession(
  config: DingTalkConfig,
  sessionWebhook: string,
  text: string,
  options: SendMessageOptions = {}
): Promise<unknown> {
  const token = await getAccessToken(config, options.log);
  const useMarkdown = options.useMarkdown !== false && (options.useMarkdown || hasMarkdownFeatures(text));
  const title = options.title || extractTitle(text, 'Message');

  let body: SessionWebhookResponse;

  if (useMarkdown) {
    let finalText = text;
    if (options.atUserId) {
      finalText = `${finalText} @${options.atUserId}`;
    }
    body = {
      msgtype: 'markdown',
      markdown: { title, text: finalText },
    };
  } else {
    body = {
      msgtype: 'text',
      text: { content: text },
    };
  }

  if (options.atUserId) {
    body.at = { atUserIds: [options.atUserId], isAtAll: false };
  }

  options.log?.debug?.(`[Message] Sending via session webhook: ${text.slice(0, 50)}...`);

  const response = await axios.post(sessionWebhook, body, {
    headers: {
      'x-acs-dingtalk-access-token': token,
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
  });

  return response.data;
}

/**
 * 主动发送文本/Markdown 消息
 * @param config 钉钉配置
 * @param target 目标 ID (用户 ID 或群会话 ID)
 * @param text 消息文本
 * @param options 发送选项
 */
export async function sendProactiveMessage(
  config: DingTalkConfig,
  target: string,
  text: string,
  options: SendMessageOptions = {}
): Promise<unknown> {
  const token = await getAccessToken(config, options.log);
  const isGroup = target.startsWith('cid');
  const useMarkdown = options.useMarkdown !== false && (options.useMarkdown || hasMarkdownFeatures(text));
  const title = options.title || extractTitle(text, 'Message');

  const url = isGroup
    ? `${DINGTALK_API}/v1.0/robot/groupMessages/send`
    : `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;

  const msgKey = useMarkdown ? 'sampleMarkdown' : 'sampleText';
  const msgParam = useMarkdown ? JSON.stringify({ title, text }) : JSON.stringify({ content: text });

  const payload: ProactiveMessagePayload = {
    robotCode: config.robotCode || config.clientId,
    msgKey,
    msgParam,
  };

  if (isGroup) {
    payload.openConversationId = target;
  } else {
    payload.userIds = [target];
  }

  options.log?.debug?.(`[Message] Sending proactive message to ${isGroup ? 'group' : 'user'} ${target}`);

  const response = await axios.post(url, payload, {
    headers: {
      'x-acs-dingtalk-access-token': token,
      'Content-Type': 'application/json',
    },
    timeout: 10_000,
  });

  return response.data;
}

/**
 * 智能发送消息 (自动选择 session webhook 或主动发送)
 * @param config 钉钉配置
 * @param conversationId 会话 ID
 * @param text 消息文本
 * @param options 扩展选项
 */
export async function sendMessage(
  config: DingTalkConfig,
  conversationId: string,
  text: string,
  options: SendMessageOptions & { sessionWebhook?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (options.sessionWebhook) {
      await sendBySession(config, options.sessionWebhook, text, options);
    } else {
      await sendProactiveMessage(config, conversationId, text, options);
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log?.error?.(`[Message] Send failed: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * 发送 Typing Indicator (思考中提示)
 * 注意：钉钉没有原生的 typing indicator，这里用临时消息模拟
 * @param config 钉钉配置
 * @param sessionWebhook Session Webhook
 * @param log 日志器
 */
export async function sendThinkingIndicator(
  config: DingTalkConfig,
  sessionWebhook: string,
  log?: Logger
): Promise<void> {
  try {
    await sendBySession(config, sessionWebhook, '🤔 思考中，请稍候...', { log });
  } catch (error) {
    log?.debug?.(`[Message] Thinking indicator failed: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * 构建消息 Payload
 * @param msgType 消息类型
 * @param content 内容
 * @param title 标题 (用于 markdown)
 */
export function buildMsgPayload(
  msgType: 'text' | 'markdown' | 'link' | 'actionCard' | 'image',
  content: string,
  title?: string
): { msgKey: string; msgParam: Record<string, unknown> } | { error: string } {
  switch (msgType) {
    case 'markdown':
      return {
        msgKey: 'sampleMarkdown',
        msgParam: {
          title: title || extractTitle(content, 'Message'),
          text: content,
        },
      };
    case 'link':
      try {
        return {
          msgKey: 'sampleLink',
          msgParam: typeof content === 'string' ? JSON.parse(content) : content,
        };
      } catch {
        return { error: 'Invalid link message format, expected JSON' };
      }
    case 'actionCard':
      try {
        return {
          msgKey: 'sampleActionCard',
          msgParam: typeof content === 'string' ? JSON.parse(content) : content,
        };
      } catch {
        return { error: 'Invalid actionCard message format, expected JSON' };
      }
    case 'image':
      return {
        msgKey: 'sampleImageMsg',
        msgParam: { photoURL: content },
      };
    case 'text':
    default:
      return {
        msgKey: 'sampleText',
        msgParam: { content },
      };
  }
}

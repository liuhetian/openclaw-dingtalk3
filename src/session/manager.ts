/**
 * Session Manager
 * 会话管理：用户会话状态、超时检测、消息去重
 */

import type { UserSession, SessionContext, Logger } from '../types.js';

/** 用户会话缓存 */
const userSessions = new Map<string, UserSession>();

/** 消息去重缓存 */
const processedMessages = new Map<string, number>();

/** 消息去重缓存过期时间 (5分钟) */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** 新会话命令列表 */
const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

// ============ 消息去重 ============

/**
 * 检查消息是否已处理过
 * @param messageId 消息 ID
 */
export function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/**
 * 标记消息为已处理
 * @param messageId 消息 ID
 */
export function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());

  // 定期清理 (每处理 100 条消息清理一次)
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

/**
 * 清理过期的消息去重缓存
 */
export function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

// ============ 会话管理 ============

/**
 * 检查消息是否是新会话命令
 * @param text 消息文本
 */
export function isNewSessionCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NEW_SESSION_COMMANDS.some((cmd) => trimmed === cmd.toLowerCase());
}

/**
 * 获取或创建用户会话 Key
 * @param senderId 发送者 ID
 * @param forceNew 是否强制创建新会话
 * @param sessionTimeout 会话超时时间 (毫秒)
 * @param log 日志器
 */
export function getSessionKey(
  senderId: string,
  forceNew: boolean,
  sessionTimeout: number,
  log?: Logger
): SessionContext {
  const now = Date.now();
  const existing = userSessions.get(senderId);

  // 强制新会话
  if (forceNew) {
    const sessionId = `dingtalk:${senderId}:${now}`;
    userSessions.set(senderId, { lastActivity: now, sessionId });
    log?.info?.(`[Session] User requested new session: ${senderId}`);
    return { sessionKey: sessionId, isNew: true, forceNew: true };
  }

  // 检查超时
  if (existing) {
    const elapsed = now - existing.lastActivity;
    if (elapsed > sessionTimeout) {
      const sessionId = `dingtalk:${senderId}:${now}`;
      userSessions.set(senderId, { lastActivity: now, sessionId });
      log?.info?.(`[Session] Session timeout (${Math.round(elapsed / 60000)}min), new session: ${senderId}`);
      return { sessionKey: sessionId, isNew: true, forceNew: false };
    }

    // 更新活跃时间
    existing.lastActivity = now;
    return { sessionKey: existing.sessionId, isNew: false, forceNew: false };
  }

  // 首次会话
  const sessionId = `dingtalk:${senderId}`;
  userSessions.set(senderId, { lastActivity: now, sessionId });
  log?.info?.(`[Session] New user session: ${senderId}`);
  return { sessionKey: sessionId, isNew: false, forceNew: false };
}

/**
 * 更新会话活跃时间
 * @param senderId 发送者 ID
 */
export function touchSession(senderId: string): void {
  const existing = userSessions.get(senderId);
  if (existing) {
    existing.lastActivity = Date.now();
  }
}

/**
 * 获取会话信息
 * @param senderId 发送者 ID
 */
export function getSession(senderId: string): UserSession | undefined {
  return userSessions.get(senderId);
}

/**
 * 删除会话
 * @param senderId 发送者 ID
 */
export function deleteSession(senderId: string): void {
  userSessions.delete(senderId);
}

/**
 * 清理所有会话
 */
export function clearAllSessions(): void {
  userSessions.clear();
}

/**
 * 获取活跃会话数量
 */
export function getActiveSessionCount(): number {
  return userSessions.size;
}

/**
 * 清理过期会话
 * @param maxAge 最大存活时间 (毫秒)
 */
export function cleanupExpiredSessions(maxAge: number): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [senderId, session] of userSessions.entries()) {
    if (now - session.lastActivity > maxAge) {
      userSessions.delete(senderId);
      cleaned++;
    }
  }

  return cleaned;
}

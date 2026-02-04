/**
 * Helper Utilities
 * 通用工具函数
 */

import type { NormalizedAllowFrom } from '../types.js';

/**
 * 规范化允许列表
 * @param list 原始允许列表
 */
export function normalizeAllowFrom(list?: string[]): NormalizedAllowFrom {
  const entries = (list ?? []).map((value) => String(value).trim()).filter(Boolean);
  const hasWildcard = entries.includes('*');
  const normalized = entries
    .filter((value) => value !== '*')
    .map((value) => value.replace(/^(dingtalk|dd|ding):/i, ''));
  const normalizedLower = normalized.map((value) => value.toLowerCase());

  return {
    entries: normalized,
    entriesLower: normalizedLower,
    hasWildcard,
    hasEntries: entries.length > 0,
  };
}

/**
 * 检查发送者是否被允许
 * @param allow 规范化的允许列表
 * @param senderId 发送者 ID
 */
export function isSenderAllowed(params: { allow: NormalizedAllowFrom; senderId?: string }): boolean {
  const { allow, senderId } = params;
  if (!allow.hasEntries) return true;
  if (allow.hasWildcard) return true;
  if (senderId && allow.entriesLower.includes(senderId.toLowerCase())) return true;
  return false;
}

/**
 * 脱敏敏感数据
 * @param data 原始数据
 */
export function maskSensitiveData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;

  const sensitiveKeys = ['clientSecret', 'appSecret', 'token', 'password', 'secret'];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      result[key] = typeof value === 'string' ? `${value.slice(0, 4)}****` : '****';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 检测文本是否包含 Markdown 特征
 * @param text 文本内容
 */
export function hasMarkdownFeatures(text: string): boolean {
  return /^[#*>-]|[*_`#[\]]/.test(text) || text.includes('\n');
}

/**
 * 从 Markdown 文本提取标题
 * @param text 文本内容
 * @param defaultTitle 默认标题
 */
export function extractTitle(text: string, defaultTitle: string): string {
  return (
    text
      .split('\n')[0]
      .replace(/^[#*\s\->]+/, '')
      .slice(0, 20) || defaultTitle
  );
}

/**
 * 生成唯一 ID
 * @param prefix 前缀
 */
export function generateId(prefix = 'id'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * 清理临时文件
 * @param log 日志器
 */
export async function cleanupOrphanedTempFiles(log?: { info?: (...args: unknown[]) => void }): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时

    let cleaned = 0;
    for (const file of files) {
      if (file.startsWith('dingtalk_')) {
        const filePath = path.join(tmpDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // 忽略单个文件清理失败
        }
      }
    }

    if (cleaned > 0) {
      log?.info?.(`[DingTalk] Cleaned up ${cleaned} orphaned temp files`);
    }
  } catch {
    // 忽略清理失败
  }
}

/**
 * 解析目标地址
 * @param to 目标地址字符串
 */
export function parseTarget(to: string): { type: 'user' | 'group'; id: string } {
  const trimmed = to.trim();

  // 去掉可能的 dingtalk: 前缀
  const normalized = trimmed.replace(/^(dingtalk|dd|ding):/i, '');

  if (normalized.startsWith('user:')) {
    return { type: 'user', id: normalized.slice(5) };
  }
  if (normalized.startsWith('group:')) {
    return { type: 'group', id: normalized.slice(6) };
  }

  // 检查是否是群会话 ID (通常以 cid 开头)
  if (normalized.startsWith('cid')) {
    return { type: 'group', id: normalized };
  }

  // 默认当作用户 ID
  return { type: 'user', id: normalized };
}

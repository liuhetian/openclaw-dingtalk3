/**
 * Group Config
 * 群组独立配置管理
 */

import type { DingTalkConfig, GroupConfig } from '../types.js';

/**
 * 解析群组配置
 * @param config 钉钉配置
 * @param groupId 群 ID
 */
export function resolveGroupConfig(config: DingTalkConfig, groupId: string): GroupConfig | undefined {
  const groups = config.groups;
  if (!groups) return undefined;

  // 精确匹配
  if (groups[groupId]) {
    return groups[groupId];
  }

  // 通配符匹配
  if (groups['*']) {
    return groups['*'];
  }

  return undefined;
}

/**
 * 获取群组系统提示词
 * @param config 钉钉配置
 * @param groupId 群 ID
 */
export function getGroupSystemPrompt(config: DingTalkConfig, groupId: string): string | undefined {
  const groupConfig = resolveGroupConfig(config, groupId);
  return groupConfig?.systemPrompt?.trim();
}

/**
 * 检查用户是否在群组允许列表中
 * @param config 钉钉配置
 * @param groupId 群 ID
 * @param userId 用户 ID
 */
export function isUserAllowedInGroup(config: DingTalkConfig, groupId: string, userId: string): boolean {
  const groupConfig = resolveGroupConfig(config, groupId);

  // 没有群组配置或没有 allowFrom，允许所有人
  if (!groupConfig?.allowFrom || groupConfig.allowFrom.length === 0) {
    return true;
  }

  return groupConfig.allowFrom.includes(userId);
}

/**
 * 构建群组上下文提示词
 * @param config 钉钉配置
 * @param groupId 群 ID
 * @param groupName 群名称
 */
export function buildGroupContextPrompt(config: DingTalkConfig, groupId: string, groupName?: string): string {
  const parts: string[] = [`DingTalk group context: conversationId=${groupId}`];

  if (groupName) {
    parts.push(`groupName=${groupName}`);
  }

  const groupConfig = resolveGroupConfig(config, groupId);
  if (groupConfig?.systemPrompt) {
    parts.push(groupConfig.systemPrompt.trim());
  }

  return parts.join('\n');
}

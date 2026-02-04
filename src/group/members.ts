/**
 * Group Members
 * 群成员追踪和持久化
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GroupRoster, Logger } from '../types.js';

/** 群成员存储目录 */
const MEMBERS_DIR = path.join(os.homedir(), '.openclaw', 'dingtalk-members');

/** 内存缓存 */
const membersCache = new Map<string, GroupRoster>();

/**
 * 获取群成员文件路径
 * @param groupId 群 ID
 */
function getMembersFilePath(groupId: string): string {
  // 安全处理 groupId (Base64 可能包含 +/)
  const safeId = groupId.replace(/\+/g, '-').replace(/\//g, '_');
  return path.join(MEMBERS_DIR, `${safeId}.json`);
}

/**
 * 记录群成员
 * @param groupId 群 ID
 * @param userId 用户 ID
 * @param name 用户名称
 * @param log 日志器
 */
export function noteGroupMember(groupId: string, userId: string, name: string, log?: Logger): void {
  if (!userId || !name) return;

  // 从缓存获取或加载
  let roster = membersCache.get(groupId);
  if (!roster) {
    roster = loadGroupMembers(groupId);
    membersCache.set(groupId, roster);
  }

  // 检查是否需要更新
  if (roster[userId] === name) return;

  roster[userId] = name;
  log?.debug?.(`[GroupMembers] Noted: ${name} (${userId}) in ${groupId}`);

  // 异步保存到文件
  saveGroupMembers(groupId, roster).catch((err) => {
    log?.warn?.(`[GroupMembers] Save failed: ${err instanceof Error ? err.message : err}`);
  });
}

/**
 * 格式化群成员列表
 * @param groupId 群 ID
 */
export function formatGroupMembers(groupId: string): string | undefined {
  const roster = membersCache.get(groupId) || loadGroupMembers(groupId);
  const entries = Object.entries(roster);

  if (entries.length === 0) return undefined;

  return entries.map(([id, name]) => `${name} (${id})`).join(', ');
}

/**
 * 获取群成员数量
 * @param groupId 群 ID
 */
export function getGroupMemberCount(groupId: string): number {
  const roster = membersCache.get(groupId) || loadGroupMembers(groupId);
  return Object.keys(roster).length;
}

/**
 * 获取群成员名称
 * @param groupId 群 ID
 * @param userId 用户 ID
 */
export function getGroupMemberName(groupId: string, userId: string): string | undefined {
  const roster = membersCache.get(groupId) || loadGroupMembers(groupId);
  return roster[userId];
}

/**
 * 加载群成员文件
 */
function loadGroupMembers(groupId: string): GroupRoster {
  const filePath = getMembersFilePath(groupId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // 忽略读取错误
  }
  return {};
}

/**
 * 保存群成员文件
 */
async function saveGroupMembers(groupId: string, roster: GroupRoster): Promise<void> {
  const filePath = getMembersFilePath(groupId);

  // 确保目录存在
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // 写入文件
  fs.writeFileSync(filePath, JSON.stringify(roster, null, 2));
}

/**
 * 清除群成员缓存
 * @param groupId 可选，指定群 ID
 */
export function clearMembersCache(groupId?: string): void {
  if (groupId) {
    membersCache.delete(groupId);
  } else {
    membersCache.clear();
  }
}

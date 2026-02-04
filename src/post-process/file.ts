/**
 * File Post-Processing
 * 文件后处理：检测标记并上传发送
 */

import * as fs from 'node:fs';
import type { ProcessContext, ProcessResult, FileInfo } from '../types.js';
import { uploadMediaToDingTalk, sendFileMessage } from '../api/media.js';

/** 文件标记正则 */
const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\]({.*?})\[\/DINGTALK_FILE\]/g;

/** 最大文件大小 (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 处理文件标记
 * @param content 内容
 * @param context 处理上下文
 */
export async function processFileMarkers(content: string, context: ProcessContext): Promise<ProcessResult> {
  const { config, target, oapiToken, log } = context;
  const statusMessages: string[] = [];

  if (!oapiToken) {
    log?.warn?.('[File] No OAPI token, skipping file processing');
    return { content: content.replace(FILE_MARKER_PATTERN, '').trim(), mediaMessages: [], statusMessages: [] };
  }

  const matches = [...content.matchAll(FILE_MARKER_PATTERN)];
  const fileInfos: FileInfo[] = [];

  // 解析文件标记
  for (const match of matches) {
    try {
      const fileInfo = JSON.parse(match[1]) as FileInfo;
      if (fileInfo.path && fileInfo.fileName) {
        fileInfos.push(fileInfo);
        log?.info?.(`[File] Found: ${fileInfo.fileName}`);
      }
    } catch (err) {
      log?.warn?.(`[File] Parse error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 清理标记
  let cleanedContent = content.replace(FILE_MARKER_PATTERN, '').trim();

  if (fileInfos.length === 0) {
    return { content: cleanedContent, mediaMessages: [], statusMessages };
  }

  log?.info?.(`[File] Processing ${fileInfos.length} files...`);

  // 处理每个文件
  for (const fileInfo of fileInfos) {
    try {
      // 检查文件存在性
      if (!fs.existsSync(fileInfo.path)) {
        statusMessages.push(`⚠️ 文件不存在: ${fileInfo.fileName}`);
        continue;
      }

      // 检查文件大小
      const stats = fs.statSync(fileInfo.path);
      if (stats.size > MAX_FILE_SIZE) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        statusMessages.push(`⚠️ 文件过大: ${fileInfo.fileName}（${sizeMB}MB，限制 20MB）`);
        continue;
      }

      // 上传文件
      const mediaId = await uploadMediaToDingTalk(fileInfo.path, 'file', oapiToken, MAX_FILE_SIZE, log);
      if (!mediaId) {
        statusMessages.push(`⚠️ 文件上传失败: ${fileInfo.fileName}`);
        continue;
      }

      // 发送文件消息
      const targetId = target.isGroup ? target.conversationId : target.userId || target.conversationId;
      await sendFileMessage(config, targetId, mediaId, fileInfo.fileName, fileInfo.fileType || 'file', log);

      statusMessages.push(`✅ 文件已发送: ${fileInfo.fileName}`);
      log?.info?.(`[File] Sent: ${fileInfo.fileName}`);
    } catch (err) {
      log?.error?.(`[File] Error: ${err instanceof Error ? err.message : err}`);
      statusMessages.push(`⚠️ 文件处理异常: ${fileInfo.fileName}`);
    }
  }

  return { content: cleanedContent, mediaMessages: [], statusMessages };
}

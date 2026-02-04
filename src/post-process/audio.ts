/**
 * Audio Post-Processing
 * 音频后处理：检测标记并上传发送
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProcessContext, ProcessResult, AudioInfo } from '../types.js';
import { uploadMediaToDingTalk, sendAudioMessage } from '../api/media.js';

/** 音频标记正则 */
const AUDIO_MARKER_PATTERN = /\[DINGTALK_AUDIO\]({.*?})\[\/DINGTALK_AUDIO\]/g;

/** 最大音频大小 (20MB) */
const MAX_AUDIO_SIZE = 20 * 1024 * 1024;

/**
 * 处理音频标记
 * @param content 内容
 * @param context 处理上下文
 */
export async function processAudioMarkers(content: string, context: ProcessContext): Promise<ProcessResult> {
  const { config, target, oapiToken, log } = context;
  const statusMessages: string[] = [];

  if (!oapiToken) {
    log?.warn?.('[Audio] No OAPI token, skipping audio processing');
    return { content: content.replace(AUDIO_MARKER_PATTERN, '').trim(), mediaMessages: [], statusMessages: [] };
  }

  const matches = [...content.matchAll(AUDIO_MARKER_PATTERN)];
  const audioInfos: AudioInfo[] = [];
  const invalidAudios: string[] = [];

  // 解析音频标记
  for (const match of matches) {
    try {
      const audioInfo = JSON.parse(match[1]) as AudioInfo;
      if (audioInfo.path && fs.existsSync(audioInfo.path)) {
        audioInfos.push(audioInfo);
        log?.info?.(`[Audio] Found: ${audioInfo.path}`);
      } else {
        invalidAudios.push(audioInfo.path || 'unknown');
        log?.warn?.(`[Audio] File not found: ${audioInfo.path}`);
      }
    } catch (err) {
      log?.warn?.(`[Audio] Parse error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 清理标记
  let cleanedContent = content.replace(AUDIO_MARKER_PATTERN, '').trim();

  // 处理无效音频
  for (const invalidPath of invalidAudios) {
    statusMessages.push(`⚠️ 音频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (audioInfos.length === 0) {
    return { content: cleanedContent, mediaMessages: [], statusMessages };
  }

  log?.info?.(`[Audio] Processing ${audioInfos.length} audio files...`);

  // 处理每个音频
  for (const audioInfo of audioInfos) {
    const fileName = path.basename(audioInfo.path);

    try {
      // 上传音频
      const mediaId = await uploadMediaToDingTalk(audioInfo.path, 'voice', oapiToken, MAX_AUDIO_SIZE, log);
      if (!mediaId) {
        statusMessages.push(`⚠️ 音频上传失败: ${fileName}（文件可能超过 20MB）`);
        continue;
      }

      // 发送音频消息
      const targetId = target.isGroup ? target.conversationId : target.userId || target.conversationId;
      await sendAudioMessage(config, targetId, mediaId, '60000', log);

      statusMessages.push(`✅ 音频已发送: ${fileName}`);
      log?.info?.(`[Audio] Sent: ${fileName}`);
    } catch (err) {
      log?.error?.(`[Audio] Error: ${err instanceof Error ? err.message : err}`);
      statusMessages.push(`⚠️ 音频处理异常: ${fileName}`);
    }
  }

  return { content: cleanedContent, mediaMessages: [], statusMessages };
}

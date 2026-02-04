/**
 * Media API
 * 媒体文件上传和下载
 */

import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DingTalkConfig, MediaFile, Logger } from '../types.js';
import { getAccessToken, getOapiAccessToken } from './token.js';
import { formatFileSize } from '../utils/helpers.js';

/** 媒体类型 */
export type MediaType = 'image' | 'file' | 'video' | 'voice';

/** 默认最大文件大小 (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 上传媒体文件到钉钉
 * @param filePath 文件路径
 * @param mediaType 媒体类型
 * @param oapiToken OAPI Token
 * @param maxSize 最大文件大小
 * @param log 日志器
 */
export async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: MediaType,
  oapiToken: string,
  maxSize: number = MAX_FILE_SIZE,
  log?: Logger
): Promise<string | null> {
  try {
    const FormData = (await import('form-data')).default;

    const absPath = normalizeFilePath(filePath);
    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[Media] File not found: ${absPath}`);
      return null;
    }

    // 检查文件大小
    const stats = fs.statSync(absPath);
    if (stats.size > maxSize) {
      log?.warn?.(`[Media] File too large: ${formatFileSize(stats.size)} > ${formatFileSize(maxSize)}`);
      return null;
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: getContentType(mediaType),
    });

    log?.info?.(`[Media] Uploading ${mediaType}: ${path.basename(absPath)} (${formatFileSize(stats.size)})`);

    const response = await axios.post(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=${mediaType}`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 60_000,
      }
    );

    const mediaId = response.data?.media_id;
    if (mediaId) {
      log?.info?.(`[Media] Upload successful: media_id=${mediaId}`);
      return mediaId;
    }

    log?.warn?.(`[Media] Upload response missing media_id: ${JSON.stringify(response.data)}`);
    return null;
  } catch (error) {
    log?.error?.(`[Media] Upload failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * 下载媒体文件
 * @param config 钉钉配置
 * @param downloadCode 下载码
 * @param log 日志器
 */
export async function downloadMedia(
  config: DingTalkConfig,
  downloadCode: string,
  log?: Logger
): Promise<MediaFile | null> {
  if (!config.robotCode) {
    log?.error?.('[Media] downloadMedia requires robotCode to be configured');
    return null;
  }

  try {
    const token = await getAccessToken(config, log);

    const response = await axios.post<{ downloadUrl?: string }>(
      'https://api.dingtalk.com/v1.0/robot/messageFiles/download',
      { downloadCode, robotCode: config.robotCode },
      {
        headers: { 'x-acs-dingtalk-access-token': token },
        timeout: 10_000,
      }
    );

    const downloadUrl = response.data?.downloadUrl;
    if (!downloadUrl) {
      log?.warn?.('[Media] Download URL not found in response');
      return null;
    }

    const mediaResponse = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });

    const contentType = mediaResponse.headers['content-type'] || 'application/octet-stream';
    const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
    const tempPath = path.join(os.tmpdir(), `dingtalk_${Date.now()}.${ext}`);

    fs.writeFileSync(tempPath, Buffer.from(mediaResponse.data as ArrayBuffer));
    log?.info?.(`[Media] Downloaded to: ${tempPath}`);

    return { path: tempPath, mimeType: contentType };
  } catch (error) {
    log?.error?.(`[Media] Download failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * 发送文件消息
 * @param config 钉钉配置
 * @param target 目标 (用户 ID 或群会话 ID)
 * @param mediaId 媒体 ID
 * @param fileName 文件名
 * @param fileType 文件类型
 * @param log 日志器
 */
export async function sendFileMessage(
  config: DingTalkConfig,
  target: string,
  mediaId: string,
  fileName: string,
  fileType: string,
  log?: Logger
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getAccessToken(config, log);
    const isGroup = target.startsWith('cid');

    const msgParam = {
      mediaId,
      fileName,
      fileType,
    };

    const body = {
      robotCode: config.robotCode || config.clientId,
      msgKey: 'sampleFile',
      msgParam: JSON.stringify(msgParam),
      ...(isGroup ? { openConversationId: target } : { userIds: [target] }),
    };

    const endpoint = isGroup
      ? 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
      : 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';

    log?.info?.(`[Media] Sending file message: ${fileName}`);

    const response = await axios.post(endpoint, body, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (response.data?.processQueryKey) {
      log?.info?.(`[Media] File message sent successfully`);
      return { ok: true };
    }

    return { ok: false, error: response.data?.message || 'Unknown error' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.error?.(`[Media] Send file message failed: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * 发送视频消息
 * @param config 钉钉配置
 * @param target 目标
 * @param videoMediaId 视频媒体 ID
 * @param picMediaId 封面媒体 ID
 * @param duration 时长 (秒)
 * @param log 日志器
 */
export async function sendVideoMessage(
  config: DingTalkConfig,
  target: string,
  videoMediaId: string,
  picMediaId: string,
  duration: number,
  log?: Logger
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getAccessToken(config, log);
    const isGroup = target.startsWith('cid');

    const msgParam = {
      duration: duration.toString(),
      videoMediaId,
      videoType: 'mp4',
      picMediaId,
    };

    const body = {
      robotCode: config.robotCode || config.clientId,
      msgKey: 'sampleVideo',
      msgParam: JSON.stringify(msgParam),
      ...(isGroup ? { openConversationId: target } : { userIds: [target] }),
    };

    const endpoint = isGroup
      ? 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
      : 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';

    log?.info?.(`[Media] Sending video message`);

    const response = await axios.post(endpoint, body, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (response.data?.processQueryKey) {
      log?.info?.(`[Media] Video message sent successfully`);
      return { ok: true };
    }

    return { ok: false, error: response.data?.message || 'Unknown error' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.error?.(`[Media] Send video message failed: ${message}`);
    return { ok: false, error: message };
  }
}

/**
 * 发送音频消息
 * @param config 钉钉配置
 * @param target 目标
 * @param mediaId 媒体 ID
 * @param duration 时长 (毫秒)
 * @param log 日志器
 */
export async function sendAudioMessage(
  config: DingTalkConfig,
  target: string,
  mediaId: string,
  duration: string = '60000',
  log?: Logger
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getAccessToken(config, log);
    const isGroup = target.startsWith('cid');

    const msgParam = {
      mediaId,
      duration,
    };

    const body = {
      robotCode: config.robotCode || config.clientId,
      msgKey: 'sampleAudio',
      msgParam: JSON.stringify(msgParam),
      ...(isGroup ? { openConversationId: target } : { userIds: [target] }),
    };

    const endpoint = isGroup
      ? 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
      : 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';

    log?.info?.(`[Media] Sending audio message`);

    const response = await axios.post(endpoint, body, {
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (response.data?.processQueryKey) {
      log?.info?.(`[Media] Audio message sent successfully`);
      return { ok: true };
    }

    return { ok: false, error: response.data?.message || 'Unknown error' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.error?.(`[Media] Send audio message failed: ${message}`);
    return { ok: false, error: message };
  }
}

// ============ 辅助函数 ============

/**
 * 规范化文件路径 (去掉 file:// 等前缀)
 */
function normalizeFilePath(filePath: string): string {
  let normalized = filePath;

  if (normalized.startsWith('file://')) {
    normalized = normalized.replace('file://', '');
  } else if (normalized.startsWith('MEDIA:')) {
    normalized = normalized.replace('MEDIA:', '');
  } else if (normalized.startsWith('attachment://')) {
    normalized = normalized.replace('attachment://', '');
  }

  // URL 解码
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // 解码失败保持原样
  }

  return normalized;
}

/**
 * 获取内容类型
 */
function getContentType(mediaType: MediaType): string {
  switch (mediaType) {
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'voice':
      return 'audio/amr';
    case 'file':
    default:
      return 'application/octet-stream';
  }
}

export { getOapiAccessToken, normalizeFilePath };

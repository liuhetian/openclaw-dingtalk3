/**
 * Video Post-Processing
 * 视频后处理：检测标记并上传发送
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProcessContext, ProcessResult, VideoInfo, VideoMetadata, Logger } from '../types.js';
import { uploadMediaToDingTalk, sendVideoMessage } from '../api/media.js';

/** 视频标记正则 */
const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\]({.*?})\[\/DINGTALK_VIDEO\]/g;

/** 最大视频大小 (20MB) */
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

/**
 * 处理视频标记
 * @param content 内容
 * @param context 处理上下文
 */
export async function processVideoMarkers(content: string, context: ProcessContext): Promise<ProcessResult> {
  const { config, target, oapiToken, log } = context;
  const statusMessages: string[] = [];

  if (!oapiToken) {
    log?.warn?.('[Video] No OAPI token, skipping video processing');
    return { content: content.replace(VIDEO_MARKER_PATTERN, '').trim(), mediaMessages: [], statusMessages: [] };
  }

  const matches = [...content.matchAll(VIDEO_MARKER_PATTERN)];
  const videoInfos: VideoInfo[] = [];
  const invalidVideos: string[] = [];

  // 解析视频标记
  for (const match of matches) {
    try {
      const videoInfo = JSON.parse(match[1]) as VideoInfo;
      if (videoInfo.path && fs.existsSync(videoInfo.path)) {
        videoInfos.push(videoInfo);
        log?.info?.(`[Video] Found: ${videoInfo.path}`);
      } else {
        invalidVideos.push(videoInfo.path || 'unknown');
        log?.warn?.(`[Video] File not found: ${videoInfo.path}`);
      }
    } catch (err) {
      log?.warn?.(`[Video] Parse error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 清理标记
  let cleanedContent = content.replace(VIDEO_MARKER_PATTERN, '').trim();

  // 处理无效视频
  for (const invalidPath of invalidVideos) {
    statusMessages.push(`⚠️ 视频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (videoInfos.length === 0) {
    return { content: cleanedContent, mediaMessages: [], statusMessages };
  }

  log?.info?.(`[Video] Processing ${videoInfos.length} videos...`);

  // 处理每个视频
  for (const videoInfo of videoInfos) {
    const fileName = path.basename(videoInfo.path);
    let thumbnailPath = '';

    try {
      // 提取元数据
      const metadata = await extractVideoMetadata(videoInfo.path, log);
      if (!metadata) {
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法读取视频信息）`);
        continue;
      }

      // 生成封面
      thumbnailPath = path.join(os.tmpdir(), `thumbnail_${Date.now()}.jpg`);
      const thumbnail = await extractVideoThumbnail(videoInfo.path, thumbnailPath, log);
      if (!thumbnail) {
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法生成封面）`);
        continue;
      }

      // 上传视频
      const videoMediaId = await uploadMediaToDingTalk(videoInfo.path, 'video', oapiToken, MAX_VIDEO_SIZE, log);
      if (!videoMediaId) {
        statusMessages.push(`⚠️ 视频上传失败: ${fileName}（文件可能超过 20MB）`);
        continue;
      }

      // 上传封面
      const picMediaId = await uploadMediaToDingTalk(thumbnailPath, 'image', oapiToken, undefined, log);
      if (!picMediaId) {
        statusMessages.push(`⚠️ 封面上传失败: ${fileName}`);
        continue;
      }

      // 发送视频消息
      const targetId = target.isGroup ? target.conversationId : target.userId || target.conversationId;
      await sendVideoMessage(config, targetId, videoMediaId, picMediaId, metadata.duration, log);

      statusMessages.push(`✅ 视频已发送: ${fileName}`);
      log?.info?.(`[Video] Sent: ${fileName}`);
    } catch (err) {
      log?.error?.(`[Video] Error: ${err instanceof Error ? err.message : err}`);
      statusMessages.push(`⚠️ 视频处理异常: ${fileName}`);
    } finally {
      // 清理临时文件
      if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        try {
          fs.unlinkSync(thumbnailPath);
        } catch {
          // 忽略
        }
      }
    }
  }

  return { content: cleanedContent, mediaMessages: [], statusMessages };
}

/**
 * 提取视频元数据
 */
async function extractVideoMetadata(filePath: string, log?: Logger): Promise<VideoMetadata | null> {
  try {
    // 尝试使用 ffprobe
    const ffmpeg = await import('fluent-ffmpeg').catch(() => null);
    if (!ffmpeg) {
      log?.warn?.('[Video] fluent-ffmpeg not available, using defaults');
      return { duration: 10, width: 1280, height: 720 };
    }

    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg').catch(() => null);
    if (ffmpegInstaller) {
      ffmpeg.default.setFfmpegPath(ffmpegInstaller.path);
    }

    return new Promise((resolve) => {
      ffmpeg.default.ffprobe(filePath, (err: Error | null, metadata: { format?: { duration?: number }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> }) => {
        if (err) {
          log?.warn?.(`[Video] ffprobe error: ${err.message}`);
          resolve({ duration: 10, width: 1280, height: 720 });
          return;
        }

        const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
        resolve({
          duration: Math.floor(metadata.format?.duration || 10),
          width: videoStream?.width || 1280,
          height: videoStream?.height || 720,
        });
      });
    });
  } catch (err) {
    log?.warn?.(`[Video] Metadata extraction failed: ${err instanceof Error ? err.message : err}`);
    return { duration: 10, width: 1280, height: 720 };
  }
}

/**
 * 提取视频封面
 */
async function extractVideoThumbnail(videoPath: string, outputPath: string, log?: Logger): Promise<string | null> {
  try {
    const ffmpeg = await import('fluent-ffmpeg').catch(() => null);
    if (!ffmpeg) {
      log?.warn?.('[Video] fluent-ffmpeg not available');
      return null;
    }

    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg').catch(() => null);
    if (ffmpegInstaller) {
      ffmpeg.default.setFfmpegPath(ffmpegInstaller.path);
    }

    return new Promise((resolve) => {
      ffmpeg
        .default(videoPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timemarks: ['1'],
          size: '?x360',
        })
        .on('end', () => {
          log?.debug?.(`[Video] Thumbnail generated: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: Error) => {
          log?.warn?.(`[Video] Thumbnail error: ${err.message}`);
          resolve(null);
        });
    });
  } catch (err) {
    log?.warn?.(`[Video] Thumbnail extraction failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

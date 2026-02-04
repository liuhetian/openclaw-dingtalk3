/**
 * Post-Processing Pipeline
 * 后处理管道：图片、视频、音频、文件的统一处理
 */

import type { ProcessContext, ProcessResult, MediaMessage } from '../types.js';
import { processImages } from './image.js';
import { processVideoMarkers } from './video.js';
import { processAudioMarkers } from './audio.js';
import { processFileMarkers } from './file.js';

/**
 * 执行完整的后处理管道
 * @param content 原始内容
 * @param context 处理上下文
 */
export async function processPostPipeline(content: string, context: ProcessContext): Promise<ProcessResult> {
  const { log, oapiToken } = context;
  const mediaMessages: MediaMessage[] = [];
  const statusMessages: string[] = [];

  let processedContent = content;

  // 1. 处理图片 (本地路径 → media_id)
  if (oapiToken) {
    log?.debug?.('[PostProcess] Processing images...');
    processedContent = await processImages(processedContent, oapiToken, log);
  }

  // 2. 处理视频标记
  log?.debug?.('[PostProcess] Processing videos...');
  const videoResult = await processVideoMarkers(processedContent, context);
  processedContent = videoResult.content;
  mediaMessages.push(...videoResult.mediaMessages);
  statusMessages.push(...videoResult.statusMessages);

  // 3. 处理音频标记
  log?.debug?.('[PostProcess] Processing audio...');
  const audioResult = await processAudioMarkers(processedContent, context);
  processedContent = audioResult.content;
  mediaMessages.push(...audioResult.mediaMessages);
  statusMessages.push(...audioResult.statusMessages);

  // 4. 处理文件标记
  log?.debug?.('[PostProcess] Processing files...');
  const fileResult = await processFileMarkers(processedContent, context);
  processedContent = fileResult.content;
  mediaMessages.push(...fileResult.mediaMessages);
  statusMessages.push(...fileResult.statusMessages);

  // 合并状态消息
  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    processedContent = processedContent ? `${processedContent}\n\n${statusText}` : statusText;
  }

  return {
    content: processedContent,
    mediaMessages,
    statusMessages,
  };
}

/**
 * 清理所有媒体标记 (不进行处理，只清理)
 * @param content 内容
 */
export function cleanAllMediaMarkers(content: string): string {
  return content
    .replace(/\[DINGTALK_FILE\].*?\[\/DINGTALK_FILE\]/gs, '')
    .replace(/\[DINGTALK_VIDEO\].*?\[\/DINGTALK_VIDEO\]/gs, '')
    .replace(/\[DINGTALK_AUDIO\].*?\[\/DINGTALK_AUDIO\]/gs, '')
    .trim();
}

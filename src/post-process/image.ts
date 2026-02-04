/**
 * Image Post-Processing
 * 图片后处理：检测本地路径并上传到钉钉
 */

import type { Logger } from '../types.js';
import { uploadMediaToDingTalk } from '../api/media.js';

/**
 * 匹配 Markdown 图片中的本地文件路径
 * - ![alt](file:///path/to/image.jpg)
 * - ![alt](/tmp/xxx.jpg)
 * - ![alt](/Users/xxx/photo.jpg)
 * - ![alt](/home/user/photo.jpg)
 */
const LOCAL_IMAGE_RE =
  /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^)]+|\/(?:tmp|var|private|Users|home|root)[^)]+|[A-Za-z]:[\\/ ][^)]+)\)/g;

/**
 * 匹配纯文本中的本地图片路径
 * 支持 backtick 包裹: `path`
 */
const BARE_IMAGE_PATH_RE =
  /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;

/**
 * 处理内容中的图片
 * @param content 原始内容
 * @param oapiToken OAPI Token
 * @param log 日志器
 */
export async function processImages(content: string, oapiToken: string, log?: Logger): Promise<string> {
  let result = content;

  // 1. 处理 Markdown 图片语法
  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  if (mdMatches.length > 0) {
    log?.info?.(`[Image] Found ${mdMatches.length} markdown images`);

    for (const match of mdMatches) {
      const [fullMatch, alt, rawPath] = match;
      const cleanPath = rawPath.replace(/\\ /g, ' ');
      const mediaId = await uploadMediaToDingTalk(cleanPath, 'image', oapiToken, undefined, log);

      if (mediaId) {
        result = result.replace(fullMatch, `![${alt}](${mediaId})`);
        log?.debug?.(`[Image] Replaced: ${cleanPath} → ${mediaId}`);
      }
    }
  }

  // 2. 处理纯文本中的图片路径
  const bareMatches = [...result.matchAll(BARE_IMAGE_PATH_RE)];
  const newBareMatches = bareMatches.filter((m) => {
    const idx = m.index!;
    const before = result.slice(Math.max(0, idx - 10), idx);
    return !before.includes('](');
  });

  if (newBareMatches.length > 0) {
    log?.info?.(`[Image] Found ${newBareMatches.length} bare image paths`);

    // 从后往前替换，避免 index 偏移
    for (const match of newBareMatches.reverse()) {
      const [fullMatch, rawPath] = match;
      const mediaId = await uploadMediaToDingTalk(rawPath, 'image', oapiToken, undefined, log);

      if (mediaId) {
        const replacement = `![](${mediaId})`;
        result = result.slice(0, match.index!) + result.slice(match.index!).replace(fullMatch, replacement);
        log?.debug?.(`[Image] Converted bare path: ${rawPath} → ${mediaId}`);
      }
    }
  }

  return result;
}

/**
 * 规范化文件路径
 */
export function normalizeFilePath(filePath: string): string {
  let normalized = filePath;

  if (normalized.startsWith('file://')) {
    normalized = normalized.replace('file://', '');
  } else if (normalized.startsWith('MEDIA:')) {
    normalized = normalized.replace('MEDIA:', '');
  } else if (normalized.startsWith('attachment://')) {
    normalized = normalized.replace('attachment://', '');
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // 解码失败保持原样
  }

  return normalized;
}

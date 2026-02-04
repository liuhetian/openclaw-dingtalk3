/**
 * Token Management
 * Access Token 管理，支持缓存和自动刷新
 */

import axios from 'axios';
import type { DingTalkConfig, TokenInfo, Logger } from '../types.js';
import { retryWithBackoff } from '../utils/retry.js';

/** Token 刷新阈值 (90 分钟) */
const TOKEN_REFRESH_THRESHOLD = 90 * 60 * 1000;

/** Token 缓存 (按 clientId 缓存) */
const tokenCache = new Map<string, { token: string; expiry: number }>();

/** OAPI Token 缓存 */
const oapiTokenCache = new Map<string, { token: string; expiry: number }>();

/**
 * 获取 Access Token (新版 API)
 * 自动缓存和刷新
 * @param config 钉钉配置
 * @param log 日志器
 */
export async function getAccessToken(config: DingTalkConfig, log?: Logger): Promise<string> {
  const cacheKey = config.clientId;
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();

  // 检查缓存是否有效（预留 60 秒 buffer）
  if (cached && cached.expiry > now + 60_000) {
    log?.debug?.('[Token] Using cached access token');
    return cached.token;
  }

  log?.info?.('[Token] Refreshing access token...');

  const token = await retryWithBackoff(
    async () => {
      const response = await axios.post<TokenInfo>(
        'https://api.dingtalk.com/v1.0/oauth2/accessToken',
        {
          appKey: config.clientId,
          appSecret: config.clientSecret,
        },
        {
          timeout: 10_000,
        }
      );

      const { accessToken, expireIn } = response.data;
      if (!accessToken) {
        throw new Error('Failed to get access token: empty response');
      }

      // 缓存 token
      tokenCache.set(cacheKey, {
        token: accessToken,
        expiry: now + expireIn * 1000,
      });

      log?.info?.(`[Token] Access token refreshed, expires in ${expireIn}s`);
      return accessToken;
    },
    { maxRetries: 3, log }
  );

  return token;
}

/**
 * 获取 OAPI Access Token (旧版 API，用于媒体上传等)
 * @param config 钉钉配置
 * @param log 日志器
 */
export async function getOapiAccessToken(config: DingTalkConfig, log?: Logger): Promise<string | null> {
  const cacheKey = config.clientId;
  const cached = oapiTokenCache.get(cacheKey);
  const now = Date.now();

  // 检查缓存是否有效
  if (cached && cached.expiry > now + 60_000) {
    log?.debug?.('[Token] Using cached OAPI token');
    return cached.token;
  }

  try {
    log?.info?.('[Token] Getting OAPI access token...');

    const response = await axios.get<{
      errcode: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    }>('https://oapi.dingtalk.com/gettoken', {
      params: {
        appkey: config.clientId,
        appsecret: config.clientSecret,
      },
      timeout: 10_000,
    });

    if (response.data.errcode !== 0 || !response.data.access_token) {
      log?.warn?.(`[Token] OAPI token failed: ${response.data.errmsg}`);
      return null;
    }

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 7200;

    // 缓存 token
    oapiTokenCache.set(cacheKey, {
      token,
      expiry: now + expiresIn * 1000,
    });

    log?.info?.(`[Token] OAPI token obtained, expires in ${expiresIn}s`);
    return token;
  } catch (error) {
    log?.error?.(`[Token] OAPI token error: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * 检查 Token 是否需要刷新
 * @param config 钉钉配置
 */
export function shouldRefreshToken(config: DingTalkConfig): boolean {
  const cached = tokenCache.get(config.clientId);
  if (!cached) return true;

  const now = Date.now();
  return now > cached.expiry - TOKEN_REFRESH_THRESHOLD;
}

/**
 * 清除 Token 缓存
 * @param clientId 可选，指定 clientId 清除
 */
export function clearTokenCache(clientId?: string): void {
  if (clientId) {
    tokenCache.delete(clientId);
    oapiTokenCache.delete(clientId);
  } else {
    tokenCache.clear();
    oapiTokenCache.clear();
  }
}

/**
 * 获取缓存的 Token 过期时间
 * @param config 钉钉配置
 */
export function getTokenExpiry(config: DingTalkConfig): number | null {
  const cached = tokenCache.get(config.clientId);
  return cached?.expiry ?? null;
}

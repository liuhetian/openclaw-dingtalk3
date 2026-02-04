/**
 * Logger Utility
 * 日志工具
 */

import type { Logger } from '../types.js';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志前缀 */
const LOG_PREFIX = '[DingTalk]';

/**
 * 创建带前缀的日志器
 * @param baseLogger 基础日志器
 * @param prefix 额外前缀
 */
export function createPrefixedLogger(baseLogger?: Logger, prefix = ''): Logger {
  const fullPrefix = prefix ? `${LOG_PREFIX}${prefix}` : LOG_PREFIX;

  return {
    debug: (...args: unknown[]) => baseLogger?.debug?.(fullPrefix, ...args),
    info: (...args: unknown[]) => baseLogger?.info?.(fullPrefix, ...args),
    warn: (...args: unknown[]) => baseLogger?.warn?.(fullPrefix, ...args),
    error: (...args: unknown[]) => baseLogger?.error?.(fullPrefix, ...args),
  };
}

/**
 * 创建控制台日志器
 * @param enableDebug 是否启用 debug 日志
 */
export function createConsoleLogger(enableDebug = false): Logger {
  return {
    debug: enableDebug ? (...args: unknown[]) => console.debug(LOG_PREFIX, ...args) : undefined,
    info: (...args: unknown[]) => console.info(LOG_PREFIX, ...args),
    warn: (...args: unknown[]) => console.warn(LOG_PREFIX, ...args),
    error: (...args: unknown[]) => console.error(LOG_PREFIX, ...args),
  };
}

/**
 * 创建空日志器
 */
export function createNullLogger(): Logger {
  return {
    debug: undefined,
    info: undefined,
    warn: undefined,
    error: undefined,
  };
}

/**
 * 记录请求日志
 * @param log 日志器
 * @param method HTTP 方法
 * @param url URL
 * @param status 状态码
 * @param duration 耗时
 */
export function logRequest(
  log: Logger | undefined,
  method: string,
  url: string,
  status?: number,
  duration?: number
): void {
  const statusStr = status ? `status=${status}` : '';
  const durationStr = duration ? `${duration}ms` : '';
  log?.debug?.(`${method} ${url} ${statusStr} ${durationStr}`.trim());
}

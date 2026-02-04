/**
 * Retry Utility
 * 指数退避重试机制
 */

import type { RetryOptions, Logger } from '../types.js';

/** 默认重试选项 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  log: undefined as unknown as Logger,
};

/**
 * 带指数退避的重试函数
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns 函数执行结果
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries) {
        opts.log?.error?.(`[Retry] All ${opts.maxRetries + 1} attempts failed: ${lastError.message}`);
        throw lastError;
      }

      // 计算延迟时间（指数退避 + 随机抖动）
      const delay = Math.min(
        opts.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
        opts.maxDelay
      );

      opts.log?.warn?.(
        `[Retry] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${Math.round(delay)}ms...`
      );

      await sleep(delay);
    }
  }

  // 这行理论上不会执行，但 TypeScript 需要
  throw lastError || new Error('Retry failed');
}

/**
 * 睡眠函数
 * @param ms 毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带超时的 Promise
 * @param promise 原始 Promise
 * @param timeoutMs 超时毫秒数
 * @param timeoutMessage 超时错误消息
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

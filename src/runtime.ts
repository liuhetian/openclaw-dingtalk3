/**
 * DingTalk Runtime Management
 * 运行时管理，保存 SDK runtime 引用
 */

import type { Logger } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginRuntime = any;

let dingTalkRuntime: PluginRuntime | null = null;
let currentLogger: Logger | undefined;

/**
 * 设置 DingTalk 运行时
 */
export function setDingTalkRuntime(runtime: PluginRuntime): void {
  console.log('[DingTalk][Runtime] 设置运行时');
  console.log('[DingTalk][Runtime] gateway.port:', runtime?.gateway?.port);
  dingTalkRuntime = runtime;
}

/**
 * 获取 DingTalk 运行时
 */
export function getDingTalkRuntime(): PluginRuntime {
  if (!dingTalkRuntime) {
    throw new Error('DingTalk runtime not initialized. Make sure the plugin is properly registered.');
  }
  return dingTalkRuntime;
}

/**
 * 检查运行时是否已初始化
 */
export function isRuntimeInitialized(): boolean {
  return dingTalkRuntime !== null;
}

/**
 * 设置当前日志器
 */
export function setCurrentLogger(logger: Logger | undefined): void {
  currentLogger = logger;
}

/**
 * 获取当前日志器
 */
export function getCurrentLogger(): Logger | undefined {
  return currentLogger;
}

/**
 * 获取 Gateway 端口
 */
export function getGatewayPort(): number {
  const rt = getDingTalkRuntime();
  return rt?.gateway?.port || 18789;
}

/**
 * 获取配置管理器
 */
export function getConfigManager(): PluginRuntime['config'] | undefined {
  return getDingTalkRuntime()?.config;
}

/**
 * 获取 Channel 工具
 */
export function getChannelUtils(): PluginRuntime['channel'] | undefined {
  return getDingTalkRuntime()?.channel;
}

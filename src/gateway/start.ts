/**
 * Gateway Start
 * DingTalk Stream Client 启动和管理
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import type {
  DingTalkConfig,
  DingTalkInboundMessage,
  GatewayStartContext,
  GatewayStopResult,
  OpenClawConfig,
} from '../types.js';
import { handleDingTalkMessage } from '../core/message-handler.js';
import { isMessageProcessed, markMessageProcessed, cleanupProcessedMessages } from '../session/manager.js';
import { cleanupOrphanedTempFiles } from '../utils/helpers.js';

/**
 * 启动 DingTalk Stream 账户
 * @param ctx Gateway 启动上下文
 */
export async function startDingTalkAccount(ctx: GatewayStartContext): Promise<GatewayStopResult> {
  const { account, cfg, abortSignal, log } = ctx;
  const config = account.config;

  log?.info?.(`[DingTalk] ========== 开始启动 DingTalk Stream ==========`);
  log?.info?.(`[DingTalk] accountId: ${account.accountId}`);
  log?.info?.(`[DingTalk] config.clientId: ${config.clientId ? config.clientId.substring(0, 10) + '...' : '未配置'}`);
  log?.info?.(`[DingTalk] config.clientSecret: ${config.clientSecret ? '已配置' : '未配置'}`);
  log?.info?.(`[DingTalk] config.enabled: ${config.enabled}`);

  if (!config.clientId || !config.clientSecret) {
    log?.error?.(`[DingTalk] 错误: clientId 或 clientSecret 未配置!`);
    throw new Error('DingTalk clientId and clientSecret are required');
  }

  log?.info?.(`[${account.accountId}] Starting DingTalk Stream client...`);

  // 清理孤立的临时文件
  await cleanupOrphanedTempFiles(log);

  // 创建 Stream 客户端
  log?.info?.(`[DingTalk] 正在创建 DWClient...`);
  const client = new DWClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    debug: config.debug || false,
    keepAlive: true,
  });
  log?.info?.(`[DingTalk] DWClient 创建成功`);

  // 注册消息回调
  log?.info?.(`[DingTalk] 正在注册回调监听器: ${TOPIC_ROBOT}`);
  client.registerCallbackListener(TOPIC_ROBOT, async (res: unknown) => {
    log?.info?.(`[DingTalk] >>>>>>>>>> 收到 Stream 回调! <<<<<<<<<<`);
    const response = res as { headers?: { messageId?: string }; data: string };
    const messageId = response.headers?.messageId;

    log?.info?.(`[DingTalk] Stream callback received, messageId=${messageId}`);
    log?.info?.(`[DingTalk] response.data 前100字符: ${response.data?.substring(0, 100)}...`);

    // 【关键修复】立即确认回调，避免钉钉服务器超时重发
    // 钉钉 Stream 模式要求及时响应，否则约60秒后会重发消息
    if (messageId) {
      client.socketCallBackResponse(messageId, { success: true });
      log?.info?.(`[DingTalk] 已立即确认回调: messageId=${messageId}`);
    }

    // 消息去重检查
    if (messageId && isMessageProcessed(messageId)) {
      log?.warn?.(`[DingTalk] 检测到重复消息，跳过处理: messageId=${messageId}`);
      return;
    }

    // 标记消息为已处理
    if (messageId) {
      markMessageProcessed(messageId);
    }

    // 异步处理消息（不阻塞回调确认）
    try {
      log?.info?.(`[DingTalk] 开始处理消息, data length=${response.data.length}`);
      const data = JSON.parse(response.data) as DingTalkInboundMessage;
      await handleDingTalkMessage({
        cfg,
        accountId: account.accountId,
        data,
        sessionWebhook: data.sessionWebhook,
        log,
        dingtalkConfig: config,
      });
    } catch (error) {
      log?.error?.(`[DingTalk] 处理消息异常: ${error instanceof Error ? error.message : error}`);
      // 注意：即使处理失败，也不需要再次响应（已经提前确认了）
    }
  });

  // 连接 Stream
  log?.info?.(`[DingTalk] 正在连接 Stream...`);
  await client.connect();
  log?.info?.(`[DingTalk] ========== Stream 连接成功! ==========`);
  log?.info?.(`[${account.accountId}] DingTalk Stream client connected`);
  log?.info?.(`[DingTalk] 等待接收消息... (已注册 ${TOPIC_ROBOT} 回调)`);

  // 停止标志
  let stopped = false;

  // 注册中止信号处理
  if (abortSignal) {
    abortSignal.addEventListener(
      'abort',
      () => {
        if (stopped) return;
        stopped = true;
        log?.info?.(`[${account.accountId}] Stopping DingTalk Stream client...`);
        cleanupProcessedMessages();
      },
      { once: true }
    );
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      log?.info?.(`[${account.accountId}] DingTalk provider stopped`);
      cleanupProcessedMessages();
    },
  };
}

/**
 * 检查配置是否完整
 * @param cfg OpenClaw 配置
 * @param accountId 账户 ID
 */
export function isConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const config = getConfig(cfg, accountId);
  return Boolean(config.clientId && config.clientSecret);
}

/**
 * 获取钉钉配置
 * @param cfg OpenClaw 配置
 * @param accountId 账户 ID
 */
export function getConfig(cfg: OpenClawConfig, accountId?: string): DingTalkConfig {
  const dingtalkCfg = cfg?.channels?.dingtalk;

  if (!dingtalkCfg) {
    return {} as DingTalkConfig;
  }

  // 检查是否为多账户配置
  if ('accounts' in dingtalkCfg && dingtalkCfg.accounts && accountId) {
    const accountConfig = dingtalkCfg.accounts[accountId];
    if (accountConfig) return accountConfig;
  }

  return dingtalkCfg as DingTalkConfig;
}

/**
 * 探测钉钉连接状态
 * @param cfg OpenClaw 配置
 */
export async function probeDingTalk(cfg: OpenClawConfig): Promise<{ ok: boolean; error?: string; details?: unknown }> {
  if (!isConfigured(cfg)) {
    return { ok: false, error: 'Not configured' };
  }

  try {
    const config = getConfig(cfg);
    const { getAccessToken } = await import('../api/token.js');
    await getAccessToken(config);
    return { ok: true, details: { clientId: config.clientId } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

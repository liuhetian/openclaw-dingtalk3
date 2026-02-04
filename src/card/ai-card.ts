/**
 * AI Card Management
 * AI 互动卡片的创建、流式更新和完成
 */

import axios from 'axios';
import { randomUUID } from 'node:crypto';
import type {
  DingTalkConfig,
  DingTalkInboundMessage,
  AICardInstance,
  AICardTarget,
  AICardCreateRequest,
  AICardStreamingRequest,
  Logger,
} from '../types.js';
import { AICardStatus } from '../types.js';
import { getAccessToken } from '../api/token.js';
import { retryWithBackoff } from '../utils/retry.js';

/** 钉钉 API 基础 URL */
const DINGTALK_API = 'https://api.dingtalk.com';

/** 默认 AI Card 模板 ID */
const DEFAULT_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

/** Token 刷新阈值 (90 分钟) */
const TOKEN_REFRESH_THRESHOLD = 90 * 60 * 1000;

/**
 * 创建并投放 AI Card
 * @param config 钉钉配置
 * @param target 投放目标
 * @param log 日志器
 */
export async function createAICard(
  config: DingTalkConfig,
  target: AICardTarget,
  log?: Logger
): Promise<AICardInstance | null> {
  const targetDesc = target.isGroup ? `群聊 ${target.conversationId}` : `用户 ${target.userId || target.conversationId}`;

  try {
    const token = await getAccessToken(config, log);
    const cardInstanceId = `card_${randomUUID()}`;

    log?.info?.(`[AICard] Creating card for ${targetDesc}, outTrackId=${cardInstanceId}`);

    // 构建 createAndDeliver 请求体
    const createBody: AICardCreateRequest = {
      cardTemplateId: config.cardTemplateId || DEFAULT_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: { cardParamMap: {} },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
      openSpaceId: target.isGroup
        ? `dtv1.card//IM_GROUP.${target.conversationId}`
        : `dtv1.card//IM_ROBOT.${target.userId || target.conversationId}`,
      userIdType: 1,
    };

    if (target.isGroup) {
      createBody.imGroupOpenDeliverModel = { robotCode: config.robotCode || config.clientId };
    } else {
      createBody.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
    }

    log?.debug?.(`[AICard] POST /v1.0/card/instances/createAndDeliver`);

    const response = await retryWithBackoff(
      async () => {
        return await axios.post(`${DINGTALK_API}/v1.0/card/instances/createAndDeliver`, createBody, {
          headers: {
            'x-acs-dingtalk-access-token': token,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        });
      },
      { maxRetries: 2, log }
    );

    log?.debug?.(`[AICard] Create response: status=${response.status}`);

    const instance: AICardInstance = {
      cardInstanceId,
      accessToken: token,
      conversationId: target.conversationId,
      accountId: target.accountId,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      state: AICardStatus.PROCESSING,
      config,
    };

    return instance;
  } catch (error) {
    log?.error?.(`[AICard] Create failed for ${targetDesc}: ${error instanceof Error ? error.message : error}`);
    if (axios.isAxiosError(error) && error.response) {
      log?.error?.(`[AICard] Error response: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

/**
 * 从入站消息创建 AI Card
 * @param config 钉钉配置
 * @param data 入站消息
 * @param accountId 账户 ID
 * @param log 日志器
 */
export async function createAICardFromMessage(
  config: DingTalkConfig,
  data: DingTalkInboundMessage,
  accountId: string,
  log?: Logger
): Promise<AICardInstance | null> {
  const isGroup = data.conversationType === '2';

  log?.debug?.(`[AICard] conversationType=${data.conversationType}, conversationId=${data.conversationId}`);

  const target: AICardTarget = {
    accountId,
    conversationId: data.conversationId,
    isGroup,
    userId: isGroup ? undefined : data.senderStaffId || data.senderId,
  };

  return createAICard(config, target, log);
}

/**
 * 流式更新 AI Card 内容
 * @param card AI Card 实例
 * @param content 内容
 * @param finished 是否完成
 * @param log 日志器
 */
export async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: Logger
): Promise<void> {
  // 检查是否需要刷新 Token（Token 有效期 2 小时，90分钟后刷新）
  const tokenAge = Date.now() - card.createdAt;
  if (tokenAge > TOKEN_REFRESH_THRESHOLD) {
    log?.debug?.('[AICard] Token age exceeds threshold, refreshing...');
    try {
      card.accessToken = await getAccessToken(card.config, log);
      log?.debug?.('[AICard] Token refreshed');
    } catch (error) {
      log?.warn?.(`[AICard] Token refresh failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 直接调用 streaming API，使用 key='content'（新版 API）
  const streamBody: AICardStreamingRequest = {
    outTrackId: card.cardInstanceId,
    guid: randomUUID(),
    key: 'content',  // 新版 API 使用 content
    content,
    isFull: true, // 全量替换
    isFinalize: finished,
    isError: false,
  };

  log?.info?.(`[AICard] PUT /v1.0/card/streaming contentLen=${content.length} isFull=true isFinalize=${finished}`);

  try {
    const response = await axios.put(`${DINGTALK_API}/v1.0/card/streaming`, streamBody, {
      headers: {
        'x-acs-dingtalk-access-token': card.accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    log?.info?.(`[AICard] Streaming response: status=${response.status}`);

    // 更新状态
    card.lastUpdated = Date.now();
    if (finished) {
      card.state = AICardStatus.FINISHED;
    } else if (card.state === AICardStatus.PROCESSING) {
      card.state = AICardStatus.INPUTING;
    }
  } catch (error) {
    // 401 错误尝试刷新 Token 重试
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      log?.warn?.('[AICard] Received 401, attempting token refresh...');
      try {
        card.accessToken = await getAccessToken(card.config, log);
        const retryResponse = await axios.put(`${DINGTALK_API}/v1.0/card/streaming`, streamBody, {
          headers: {
            'x-acs-dingtalk-access-token': card.accessToken,
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
        });
        log?.info?.(`[AICard] Retry succeeded: status=${retryResponse.status}`);
        card.lastUpdated = Date.now();
        if (finished) {
          card.state = AICardStatus.FINISHED;
        } else if (card.state === AICardStatus.PROCESSING) {
          card.state = AICardStatus.INPUTING;
        }
        return;
      } catch (retryError) {
        log?.error?.(`[AICard] Retry failed: ${retryError instanceof Error ? retryError.message : retryError}`);
      }
    }

    card.state = AICardStatus.FAILED;
    card.lastUpdated = Date.now();
    log?.error?.(`[AICard] Streaming failed: ${error instanceof Error ? error.message : error}`);
    if (axios.isAxiosError(error) && error.response) {
      log?.error?.(`[AICard] Error response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * 完成 AI Card
 * @param card AI Card 实例
 * @param content 最终内容
 * @param log 日志器
 */
export async function finishAICard(card: AICardInstance, content: string, log?: Logger): Promise<void> {
  log?.info?.(`[AICard] Finishing card, content length=${content.length}`);
  
  // 直接用 isFinalize=true 关闭流式通道，API 会自动处理状态更新
  await streamAICard(card, content, true, log);
}

/**
 * 检查卡片是否处于终态
 * @param state 卡片状态
 */
export function isCardInTerminalState(state: string): boolean {
  return state === AICardStatus.FINISHED || state === AICardStatus.FAILED;
}

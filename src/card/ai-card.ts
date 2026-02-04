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

    log?.info?.(`[AICard] POST /v1.0/card/instances/createAndDeliver`);
    log?.info?.(`[AICard] Request body: ${JSON.stringify(createBody)}`);

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

    log?.info?.(`[AICard] Create response: status=${response.status}, data=${JSON.stringify(response.data)}`);

    const instance: AICardInstance = {
      cardInstanceId,
      accessToken: token,
      conversationId: target.conversationId,
      accountId: target.accountId,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      state: AICardStatus.PROCESSING,
      config,
      inputingStarted: false,  // 首次 streaming 前需要切换到 INPUTING 状态
    };

    return instance;
  } catch (error) {
    log?.error?.(`[AICard] Create failed for ${targetDesc}: ${error instanceof Error ? error.message : error}`);
    if (axios.isAxiosError(error) && error.response) {
      log?.error?.(`[AICard] Error response: ${JSON.stringify(error.response.data)}`);
      
      // 如果是卡片模板相关错误，给出友好提示
      const errMsg = JSON.stringify(error.response.data);
      if (errMsg.includes('template') || errMsg.includes('模板') || error.response.status === 404) {
        log?.error?.(`[AICard] ⚠️ 可能是 cardTemplateId 配置错误！`);
        log?.error?.(`[AICard] 请在钉钉卡片平台创建 AI Card 模板，并配置正确的 cardTemplateId`);
        log?.error?.(`[AICard] 或者改用 messageType: "markdown" 模式`);
      }
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
 * 参照 dingtalk-moltbot-connector 的成功实现：
 * 1. 首次 streaming 前，先切换到 INPUTING 状态
 * 2. 使用 key='msgContent' 而非 'content'
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

  // 【关键】首次 streaming 前，先调用 PUT /v1.0/card/instances 切换到 INPUTING 状态
  // 这是钉钉 AI Card API 的必需步骤，否则会返回 500 错误
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: '',
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({
            order: ['msgContent'],  // 只声明实际使用的字段
          }),
        },
      },
    };

    log?.info?.(`[AICard] PUT /v1.0/card/instances (INPUTING) outTrackId=${card.cardInstanceId}`);

    try {
      const statusResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, statusBody, {
        headers: {
          'x-acs-dingtalk-access-token': card.accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      });
      log?.info?.(`[AICard] INPUTING response: status=${statusResp.status}, data=${JSON.stringify(statusResp.data)}`);
    } catch (error) {
      log?.error?.(`[AICard] INPUTING switch failed: ${error instanceof Error ? error.message : error}`);
      if (axios.isAxiosError(error) && error.response) {
        log?.error?.(`[AICard] Error response: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }

    card.inputingStarted = true;
  }

  // 调用 streaming API 更新内容，使用 key='msgContent'（不是 'content'）
  const streamBody: AICardStreamingRequest = {
    outTrackId: card.cardInstanceId,
    guid: randomUUID(),
    key: 'msgContent',  // 【关键】使用 msgContent 而非 content
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

    log?.info?.(`[AICard] Streaming response: status=${response.status}, data=${JSON.stringify(response.data)}`);

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
      
      // 500 错误通常是卡片模板或字段配置问题
      if (error.response.status === 500) {
        log?.error?.(`[AICard] ⚠️ 钉钉返回 500 错误，可能原因：`);
        log?.error?.(`[AICard]   1. cardTemplateId 不正确（需要在钉钉卡片平台创建自己的 AI Card 模板）`);
        log?.error?.(`[AICard]   2. 卡片模板中缺少 'msgContent' 字段`);
        log?.error?.(`[AICard]   3. 权限不足（需要 Card.Streaming.Write 和 Card.Instance.Write）`);
        log?.error?.(`[AICard] 建议改用 messageType: "markdown" 模式避免此问题`);
      }
    }
    throw error;
  }
}

/**
 * 完成 AI Card
 * 参照 dingtalk-moltbot-connector 的成功实现：
 * 1. 先用 isFinalize=true 关闭流式通道
 * 2. 再调用 PUT /v1.0/card/instances 设置 FINISHED 状态
 * @param card AI Card 实例
 * @param content 最终内容
 * @param log 日志器
 */
export async function finishAICard(card: AICardInstance, content: string, log?: Logger): Promise<void> {
  log?.info?.(`[AICard] Finishing card, content length=${content.length}`);
  
  // 1. 先用 isFinalize=true 关闭流式通道
  await streamAICard(card, content, true, log);

  // 2. 再调用 PUT /v1.0/card/instances 设置 FINISHED 状态
  const finishBody = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: content,
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({
          order: ['msgContent'],  // 只声明实际使用的字段
        }),
      },
    },
  };

  log?.info?.(`[AICard] PUT /v1.0/card/instances (FINISHED) outTrackId=${card.cardInstanceId}`);

  try {
    const finishResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, finishBody, {
      headers: {
        'x-acs-dingtalk-access-token': card.accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    log?.info?.(`[AICard] FINISHED response: status=${finishResp.status}, data=${JSON.stringify(finishResp.data)}`);
  } catch (error) {
    log?.error?.(`[AICard] FINISHED update failed: ${error instanceof Error ? error.message : error}`);
    if (axios.isAxiosError(error) && error.response) {
      log?.error?.(`[AICard] Error response: ${JSON.stringify(error.response.data)}`);
    }
    // 不抛出错误，因为流式通道已经关闭，状态更新失败不影响用户体验
  }
}

/**
 * 检查卡片是否处于终态
 * @param state 卡片状态
 */
export function isCardInTerminalState(state: string): boolean {
  return state === AICardStatus.FINISHED || state === AICardStatus.FAILED;
}

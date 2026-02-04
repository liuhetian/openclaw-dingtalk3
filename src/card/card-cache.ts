/**
 * AI Card Cache
 * AI Card 缓存和复用管理
 */

import type { AICardInstance, AICardTarget, DingTalkConfig, Logger } from '../types.js';
import { createAICard, isCardInTerminalState } from './ai-card.js';

/** AI Card 实例缓存 */
const cardInstances = new Map<string, AICardInstance>();

/** 目标到活跃卡片的映射 (accountId:conversationId -> cardInstanceId) */
const activeCardsByTarget = new Map<string, string>();

/** 缓存 TTL (1 小时) */
const CARD_CACHE_TTL = 60 * 60 * 1000;

/**
 * 生成目标 Key
 * @param accountId 账户 ID
 * @param conversationId 会话 ID
 */
function getTargetKey(accountId: string, conversationId: string): string {
  return `${accountId}:${conversationId}`;
}

/**
 * 获取或创建 AI Card
 * @param config 钉钉配置
 * @param target 投放目标
 * @param log 日志器
 */
export async function getOrCreateCard(
  config: DingTalkConfig,
  target: AICardTarget,
  log?: Logger
): Promise<AICardInstance | null> {
  const targetKey = getTargetKey(target.accountId, target.conversationId);

  // 查找现有活跃卡片
  const existingCardId = activeCardsByTarget.get(targetKey);
  if (existingCardId) {
    const existingCard = cardInstances.get(existingCardId);
    if (existingCard && !isCardInTerminalState(existingCard.state)) {
      log?.debug?.(`[CardCache] Reusing active card: ${existingCardId}`);
      return existingCard;
    }
    // 清理无效映射
    activeCardsByTarget.delete(targetKey);
  }

  // 创建新卡片
  log?.debug?.(`[CardCache] Creating new card for ${targetKey}`);
  const newCard = await createAICard(config, target, log);

  if (newCard) {
    cardInstances.set(newCard.cardInstanceId, newCard);
    activeCardsByTarget.set(targetKey, newCard.cardInstanceId);
    log?.debug?.(`[CardCache] Card cached: ${newCard.cardInstanceId}`);
  }

  return newCard;
}

/**
 * 获取缓存的卡片
 * @param cardInstanceId 卡片实例 ID
 */
export function getCachedCard(cardInstanceId: string): AICardInstance | undefined {
  return cardInstances.get(cardInstanceId);
}

/**
 * 获取目标的活跃卡片
 * @param accountId 账户 ID
 * @param conversationId 会话 ID
 */
export function getActiveCardForTarget(accountId: string, conversationId: string): AICardInstance | undefined {
  const targetKey = getTargetKey(accountId, conversationId);
  const cardId = activeCardsByTarget.get(targetKey);
  if (!cardId) return undefined;

  const card = cardInstances.get(cardId);
  if (!card || isCardInTerminalState(card.state)) {
    // 清理无效映射
    activeCardsByTarget.delete(targetKey);
    return undefined;
  }

  return card;
}

/**
 * 更新卡片状态
 * @param cardInstanceId 卡片实例 ID
 * @param state 新状态
 */
export function updateCardState(cardInstanceId: string, state: string): void {
  const card = cardInstances.get(cardInstanceId);
  if (card) {
    card.state = state as AICardInstance['state'];
    card.lastUpdated = Date.now();
  }
}

/**
 * 移除目标的活跃卡片映射
 * @param accountId 账户 ID
 * @param conversationId 会话 ID
 */
export function removeActiveCard(accountId: string, conversationId: string): void {
  const targetKey = getTargetKey(accountId, conversationId);
  activeCardsByTarget.delete(targetKey);
}

/**
 * 清理过期卡片缓存
 */
export function cleanupCardCache(): void {
  const now = Date.now();

  // 清理已完成/失败的过期卡片
  for (const [cardId, card] of cardInstances.entries()) {
    if (isCardInTerminalState(card.state) && now - card.lastUpdated > CARD_CACHE_TTL) {
      cardInstances.delete(cardId);

      // 同时清理活跃卡片映射
      for (const [targetKey, mappedCardId] of activeCardsByTarget.entries()) {
        if (mappedCardId === cardId) {
          activeCardsByTarget.delete(targetKey);
          break;
        }
      }
    }
  }
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): { totalCards: number; activeTargets: number } {
  return {
    totalCards: cardInstances.size,
    activeTargets: activeCardsByTarget.size,
  };
}

/**
 * 清空所有缓存
 */
export function clearAllCache(): void {
  cardInstances.clear();
  activeCardsByTarget.clear();
}

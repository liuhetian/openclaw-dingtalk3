/**
 * DingTalk Channel Definition
 * Channel 插件定义，实现 SDK Channel 接口
 */

import type { OpenClawConfig } from './types.js';
import { ChannelConfigSchema, ConfigUIHints } from './config-schema.js';
import { startDingTalkAccount, getConfig, isConfigured, probeDingTalk } from './gateway/start.js';
import { sendToUser, sendToGroup } from './api/proactive.js';
import { parseTarget } from './utils/helpers.js';

/**
 * DingTalk Channel Plugin 定义
 */
export const dingtalkPlugin = {
  id: 'dingtalk',

  meta: {
    id: 'dingtalk',
    label: 'DingTalk',
    selectionLabel: 'DingTalk (钉钉)',
    docsPath: '/channels/dingtalk',
    blurb: '钉钉企业内部机器人，Stream 模式 + AI Card 真流式输出，无需公网 IP。',
    aliases: ['dd', 'ding'],
  },

  configSchema: ChannelConfigSchema,
  configUIHints: ConfigUIHints,

  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
    outbound: true,
  },

  reload: { configPrefixes: ['channels.dingtalk'] },

  // ============ 配置管理 ============

  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] => {
      const config = getConfig(cfg);
      if ('accounts' in config && config.accounts) {
        return Object.keys(config.accounts);
      }
      return isConfigured(cfg) ? ['default'] : [];
    },

    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => {
      const config = getConfig(cfg, accountId);
      const id = accountId || 'default';
      return {
        accountId: id,
        config,
        enabled: config.enabled !== false,
      };
    },

    defaultAccountId: (): string => 'default',

    isConfigured: (account: { config?: { clientId?: string; clientSecret?: string } }): boolean => {
      return Boolean(account.config?.clientId && account.config?.clientSecret);
    },

    describeAccount: (account: { accountId: string; config?: { clientId?: string; name?: string }; enabled?: boolean }) => ({
      accountId: account.accountId,
      name: account.config?.name || 'DingTalk',
      enabled: account.enabled,
      configured: Boolean(account.config?.clientId),
    }),
  },

  // ============ 安全策略 ============

  security: {
    resolveDmPolicy: ({ account }: { account: { config?: { dmPolicy?: string; allowFrom?: string[] } } }) => ({
      policy: account.config?.dmPolicy || 'open',
      allowFrom: account.config?.allowFrom || [],
      policyPath: 'channels.dingtalk.dmPolicy',
      allowFromPath: 'channels.dingtalk.allowFrom',
      approveHint: '使用 /allow dingtalk:<userId> 批准用户',
      normalizeEntry: (raw: string) => raw.replace(/^(dingtalk|dd|ding):/i, ''),
    }),
  },

  // ============ 群组 ============

  groups: {
    resolveRequireMention: ({ cfg }: { cfg: OpenClawConfig }): boolean => {
      const config = getConfig(cfg);
      return config.groupPolicy !== 'open';
    },
    resolveGroupIntroHint: ({ groupId, groupChannel }: { groupId: string; groupChannel?: string }): string | undefined => {
      const parts = [`conversationId=${groupId}`];
      if (groupChannel) parts.push(`sessionKey=${groupChannel}`);
      return `DingTalk IDs: ${parts.join(', ')}.`;
    },
  },

  // ============ 消息 ============

  messaging: {
    normalizeTarget: ({ target }: { target?: string }) => {
      if (!target) return null;
      const trimmed = target.trim().replace(/^(dingtalk|dd|ding):/i, '');
      return { targetId: trimmed };
    },
    targetResolver: {
      // 支持格式: user:<userId>, group:<conversationId>, 或直接 <conversationId>
      // conversationId 通常以 cid 开头，可能包含 Base64 字符 (+/=)
      looksLikeId: (id: string): boolean => /^(user:|group:)?[\w+/:=-]+$/.test(id),
      hint: 'user:<userId> 或 group:<conversationId>',
    },
  },

  // ============ 出站消息 ============

  outbound: {
    deliveryMode: 'direct' as const,
    textChunkLimit: 4000,

    resolveTarget: ({ to }: { to?: string }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error('DingTalk message requires --to <target>'),
        };
      }
      return { ok: true, to: trimmed };
    },

    sendText: async ({ cfg, to, text, accountId, log }: {
      cfg: OpenClawConfig;
      to: string;
      text: string;
      accountId?: string;
      log?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
    }) => {
      const config = getConfig(cfg, accountId);

      if (!config.clientId) {
        return { ok: false, error: 'DingTalk not configured' };
      }

      const parsed = parseTarget(to);
      log?.info?.(`[DingTalk] sendText to ${parsed.type}:${parsed.id}`);

      try {
        if (parsed.type === 'group') {
          const result = await sendToGroup(config, parsed.id, text, { log });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        } else {
          const result = await sendToUser(config, parsed.id, text, { log });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, log }: {
      cfg: OpenClawConfig;
      to: string;
      text?: string;
      mediaUrl?: string;
      accountId?: string;
      log?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
    }) => {
      const config = getConfig(cfg, accountId);

      if (!config.clientId) {
        return { ok: false, error: 'DingTalk not configured' };
      }

      // 钉钉不支持直接发送媒体 URL，转为文本消息
      const content = mediaUrl ? (text ? `${text}\n\n![](${mediaUrl})` : `![](${mediaUrl})`) : text || '';

      const parsed = parseTarget(to);

      try {
        if (parsed.type === 'group') {
          const result = await sendToGroup(config, parsed.id, content, { log });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        } else {
          const result = await sendToUser(config, parsed.id, content, { log });
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  },

  // ============ Gateway ============

  gateway: {
    startAccount: startDingTalkAccount,
  },

  // ============ 状态 ============

  status: {
    defaultRuntime: {
      accountId: 'default',
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },

    probe: async ({ cfg }: { cfg: OpenClawConfig }) => {
      return probeDingTalk(cfg);
    },

    buildChannelSummary: ({ snapshot }: { snapshot?: { configured?: boolean; running?: boolean; lastStartAt?: string | null; lastStopAt?: string | null; lastError?: string | null } }) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};

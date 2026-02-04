/**
 * DingTalk Configuration Schema
 * 使用 Zod 进行配置验证
 */

import { z } from 'zod';

/** 消息类型 Schema */
const MessageTypeSchema = z.enum(['card', 'markdown', 'text', 'auto']).default('card');

/** 私聊策略 Schema */
const DmPolicySchema = z.enum(['open', 'pairing', 'allowlist']).default('open');

/** 群聊策略 Schema */
const GroupPolicySchema = z.enum(['open', 'allowlist']).default('open');

/** 长文本处理模式 Schema */
const LongTextModeSchema = z.enum(['chunk', 'file']).default('chunk');

/** 群组配置 Schema */
const GroupConfigSchema = z.object({
  systemPrompt: z.string().optional(),
  allowFrom: z.array(z.string()).optional(),
});

/** 钉钉配置 Schema */
export const DingTalkConfigSchema = z.object({
  // 基础配置
  enabled: z.boolean().default(true),
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
  robotCode: z.string().optional(),
  corpId: z.string().optional(),
  agentId: z.string().optional(),

  // 消息模式
  messageType: MessageTypeSchema,
  cardTemplateId: z.string().optional(),

  // 会话管理
  sessionTimeout: z.number().default(30 * 60 * 1000), // 30 分钟
  enableSessionCommands: z.boolean().default(true),

  // 长文本处理
  longTextMode: LongTextModeSchema,
  longTextThreshold: z.number().default(4000),

  // 体验优化
  showThinking: z.boolean().default(true),
  typingIndicator: z.boolean().default(true),

  // 媒体处理
  enableMediaUpload: z.boolean().default(true),
  enableVideoProcessing: z.boolean().default(true),

  // 安全策略
  dmPolicy: DmPolicySchema,
  allowFrom: z.array(z.string()).default([]),
  groupPolicy: GroupPolicySchema,
  groupAllowlist: z.array(z.string()).default([]),

  // 群组配置
  groups: z.record(z.string(), GroupConfigSchema).optional(),

  // Gateway 认证
  gatewayToken: z.string().optional(),
  gatewayPassword: z.string().optional(),

  // 调试
  debug: z.boolean().default(false),
});

/** 配置类型推断 */
export type DingTalkConfigInput = z.input<typeof DingTalkConfigSchema>;
export type DingTalkConfigOutput = z.output<typeof DingTalkConfigSchema>;

/** 验证配置 */
export function validateConfig(config: unknown): DingTalkConfigOutput {
  return DingTalkConfigSchema.parse(config);
}

/** 安全验证配置（返回错误而非抛出） */
export function safeValidateConfig(config: unknown): {
  success: boolean;
  data?: DingTalkConfigOutput;
  error?: z.ZodError;
} {
  const result = DingTalkConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/** 获取默认配置 */
export function getDefaultConfig(): Partial<DingTalkConfigOutput> {
  return {
    enabled: true,
    messageType: 'card',
    sessionTimeout: 30 * 60 * 1000,
    enableSessionCommands: true,
    longTextMode: 'chunk',
    longTextThreshold: 4000,
    showThinking: true,
    typingIndicator: true,
    enableMediaUpload: true,
    enableVideoProcessing: true,
    dmPolicy: 'open',
    allowFrom: [],
    groupPolicy: 'open',
    groupAllowlist: [],
    debug: false,
  };
}

/** Channel 配置 Schema (用于 SDK) */
export const ChannelConfigSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    enabled: { type: 'boolean', default: true },
    clientId: { type: 'string', description: 'DingTalk App Key (Client ID)' },
    clientSecret: { type: 'string', description: 'DingTalk App Secret (Client Secret)' },
    robotCode: { type: 'string', description: 'Robot Code (defaults to clientId)' },
    messageType: {
      type: 'string',
      enum: ['card', 'markdown', 'text', 'auto'],
      default: 'card',
      description: 'Message type: card for AI Card streaming, markdown for rich text',
    },
    cardTemplateId: { type: 'string', description: 'AI Card template ID' },
    sessionTimeout: {
      type: 'number',
      default: 1800000,
      description: 'Session timeout in ms (default 30min)',
    },
    enableSessionCommands: {
      type: 'boolean',
      default: true,
      description: 'Enable session commands (/new, /reset)',
    },
    longTextMode: {
      type: 'string',
      enum: ['chunk', 'file'],
      default: 'chunk',
      description: 'Long text handling: chunk or file',
    },
    longTextThreshold: { type: 'number', default: 4000, description: 'Long text threshold' },
    showThinking: { type: 'boolean', default: true, description: 'Show thinking indicator' },
    enableMediaUpload: { type: 'boolean', default: true, description: 'Enable media upload' },
    dmPolicy: {
      type: 'string',
      enum: ['open', 'pairing', 'allowlist'],
      default: 'open',
      description: 'DM policy',
    },
    allowFrom: { type: 'array', items: { type: 'string' }, description: 'Allowed sender IDs' },
    groupPolicy: {
      type: 'string',
      enum: ['open', 'allowlist'],
      default: 'open',
      description: 'Group policy',
    },
    groupAllowlist: { type: 'array', items: { type: 'string' }, description: 'Allowed group IDs' },
    gatewayToken: { type: 'string', description: 'Gateway auth token' },
    gatewayPassword: { type: 'string', description: 'Gateway auth password' },
    debug: { type: 'boolean', default: false, description: 'Enable debug logging' },
  },
  required: ['clientId', 'clientSecret'],
};

/** UI 提示配置 */
export const ConfigUIHints = {
  enabled: { label: 'Enable DingTalk' },
  clientId: { label: 'App Key', sensitive: false },
  clientSecret: { label: 'App Secret', sensitive: true },
  messageType: { label: 'Message Type' },
  dmPolicy: { label: 'DM Policy' },
  groupPolicy: { label: 'Group Policy' },
  gatewayToken: { label: 'Gateway Token', sensitive: true },
};

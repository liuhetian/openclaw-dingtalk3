/**
 * DingTalk Channel Types
 * 完整的类型定义，覆盖所有功能模块
 */

// ============ 配置相关类型 ============

/** 消息类型 */
export type MessageType = 'card' | 'markdown' | 'text' | 'auto';

/** 私聊策略 */
export type DmPolicy = 'open' | 'pairing' | 'allowlist';

/** 群聊策略 */
export type GroupPolicy = 'open' | 'allowlist';

/** 长文本处理模式 */
export type LongTextMode = 'chunk' | 'file';

/** 群组配置 */
export interface GroupConfig {
  systemPrompt?: string;
  allowFrom?: string[];
}

/** 钉钉 Channel 配置 */
export interface DingTalkConfig {
  // 基础配置
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  corpId?: string;
  agentId?: string;

  // 消息模式
  messageType: MessageType;
  cardTemplateId?: string;

  // 会话管理
  sessionTimeout: number;
  enableSessionCommands: boolean;

  // 长文本处理
  longTextMode: LongTextMode;
  longTextThreshold: number;

  // 体验优化
  showThinking: boolean;
  typingIndicator: boolean;

  // 媒体处理
  enableMediaUpload: boolean;
  enableVideoProcessing: boolean;

  // 安全策略
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: GroupPolicy;
  groupAllowlist: string[];

  // 群组配置
  groups?: Record<string, GroupConfig>;

  // Gateway 认证
  gatewayToken?: string;
  gatewayPassword?: string;

  // 调试
  debug?: boolean;
}

/** 多账户配置 */
export interface DingTalkChannelConfig {
  accounts?: Record<string, DingTalkConfig>;
}

// ============ Token 相关类型 ============

/** Token 信息 */
export interface TokenInfo {
  accessToken: string;
  expireIn: number;
}

/** Token 缓存 */
export interface TokenCache {
  token: string;
  expiry: number;
}

// ============ 消息相关类型 ============

/** 钉钉入站消息 */
export interface DingTalkInboundMessage {
  // 消息基础信息
  msgId: string;
  msgtype: string;
  createAt: number;

  // 发送者信息
  senderId: string;
  senderStaffId?: string;
  senderNick?: string;
  senderCorpId?: string;

  // 会话信息
  conversationId: string;
  conversationType: '1' | '2'; // 1=私聊, 2=群聊
  conversationTitle?: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;

  // 会话 Webhook
  sessionWebhook: string;
  sessionWebhookExpiredTime?: number;

  // 群聊相关
  isInAtList?: boolean;
  atUsers?: Array<{
    dingtalkId: string;
    staffId?: string;
  }>;

  // 消息内容
  text?: {
    content: string;
  };
  content?: {
    richText?: Array<{
      type: string;
      text?: string;
      atName?: string;
    }>;
    downloadCode?: string;
    fileName?: string;
    recognition?: string;
  };
}

/** 解析后的消息内容 */
export interface MessageContent {
  text: string;
  messageType: string;
  mediaPath?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'file';
}

/** 消息发送选项 */
export interface SendMessageOptions {
  useMarkdown?: boolean;
  title?: string;
  atUserId?: string | null;
  log?: Logger;
  accountId?: string;
}

// ============ AI Card 相关类型 ============

/** AI Card 状态 */
export const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

export type AICardStatusType = (typeof AICardStatus)[keyof typeof AICardStatus];

/** AI Card 实例 */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  conversationId: string;
  accountId: string;
  createdAt: number;
  lastUpdated: number;
  state: AICardStatusType;
  config: DingTalkConfig;
}

/** AI Card 目标 */
export interface AICardTarget {
  accountId: string;
  conversationId: string;
  isGroup: boolean;
  userId?: string;
}

/** AI Card 创建请求 */
export interface AICardCreateRequest {
  cardTemplateId: string;
  outTrackId: string;
  cardData: {
    cardParamMap: Record<string, string>;
  };
  callbackType: 'STREAM';
  imGroupOpenSpaceModel?: { supportForward: boolean };
  imRobotOpenSpaceModel?: { supportForward: boolean };
  openSpaceId: string;
  userIdType: number;
  imGroupOpenDeliverModel?: { robotCode: string };
  imRobotOpenDeliverModel?: { spaceType: string };
}

/** AI Card 流式更新请求 */
export interface AICardStreamingRequest {
  outTrackId: string;
  guid: string;
  key: string;
  content: string;
  isFull: boolean;
  isFinalize: boolean;
  isError: boolean;
}

// ============ Session 相关类型 ============

/** 用户会话状态 */
export interface UserSession {
  lastActivity: number;
  sessionId: string;
}

/** 会话上下文 */
export interface SessionContext {
  sessionKey: string;
  isNew: boolean;
  forceNew: boolean;
}

// ============ 后处理相关类型 ============

/** 媒体文件 */
export interface MediaFile {
  path: string;
  mimeType: string;
}

/** 文件信息 */
export interface FileInfo {
  path: string;
  fileName: string;
  fileType: string;
}

/** 视频信息 */
export interface VideoInfo {
  path: string;
}

/** 视频元数据 */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/** 音频信息 */
export interface AudioInfo {
  path: string;
}

/** 后处理上下文 */
export interface ProcessContext {
  config: DingTalkConfig;
  target: AICardTarget;
  oapiToken: string | null;
  log?: Logger;
  useProactiveApi?: boolean;
}

/** 后处理结果 */
export interface ProcessResult {
  content: string;
  mediaMessages: MediaMessage[];
  statusMessages: string[];
}

/** 媒体消息 */
export interface MediaMessage {
  type: 'image' | 'video' | 'audio' | 'file';
  mediaId: string;
  fileName?: string;
  fileType?: string;
  metadata?: VideoMetadata;
}

// ============ 主动发送相关类型 ============

/** 主动发送消息类型 */
export type ProactiveMsgType = 'text' | 'markdown' | 'link' | 'actionCard' | 'image';

/** 主动发送选项 */
export interface ProactiveSendOptions {
  msgType?: ProactiveMsgType;
  title?: string;
  log?: Logger;
  useAICard?: boolean;
  fallbackToNormal?: boolean;
}

/** 发送结果 */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;
  error?: string;
  usedAICard?: boolean;
}

/** 主动消息 Payload */
export interface ProactiveMessagePayload {
  robotCode: string;
  msgKey: string;
  msgParam: string;
  openConversationId?: string;
  userIds?: string[];
}

// ============ Gateway 相关类型 ============

/** Gateway 启动上下文 */
export interface GatewayStartContext {
  account: {
    accountId: string;
    config: DingTalkConfig;
  };
  cfg: OpenClawConfig;
  abortSignal?: AbortSignal;
  log?: Logger;
}

/** Gateway 停止结果 */
export interface GatewayStopResult {
  stop: () => void;
}

/** 消息处理参数 */
export interface HandleMessageParams {
  cfg: OpenClawConfig;
  accountId: string;
  data: DingTalkInboundMessage;
  sessionWebhook: string;
  log?: Logger;
  dingtalkConfig: DingTalkConfig;
}

// ============ 群组相关类型 ============

/** 群成员信息 */
export interface GroupMember {
  userId: string;
  name: string;
  lastSeen?: number;
}

/** 群成员名册 */
export type GroupRoster = Record<string, string>;

// ============ 工具类型 ============

/** 日志接口 */
export interface Logger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

/** 重试选项 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  log?: Logger;
}

/** OpenClaw 配置 (简化版) */
export interface OpenClawConfig {
  channels?: {
    dingtalk?: DingTalkConfig | DingTalkChannelConfig;
  };
  session?: {
    store?: string;
  };
  gateway?: {
    port?: number;
    auth?: {
      token?: string;
    };
  };
}

/** Session Webhook 响应 */
export interface SessionWebhookResponse {
  msgtype: string;
  markdown?: {
    title: string;
    text: string;
  };
  text?: {
    content: string;
  };
  at?: {
    atUserIds: string[];
    isAtAll: boolean;
  };
}

/** Axios 响应 (简化) */
export type AxiosResponse = unknown;

// ============ 规范化类型 ============

/** 规范化的允许列表 */
export interface NormalizedAllowFrom {
  entries: string[];
  entriesLower: string[];
  hasWildcard: boolean;
  hasEntries: boolean;
}

// ============ 流式相关类型 ============

/** Gateway 流式选项 */
export interface GatewayStreamOptions {
  userContent: string;
  systemPrompts: string[];
  sessionKey: string;
  gatewayAuth?: string;
  gatewayPort?: number;
  log?: Logger;
}

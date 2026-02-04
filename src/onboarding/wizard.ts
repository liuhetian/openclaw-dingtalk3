/**
 * Onboarding Wizard
 * 交互式配置向导
 */

import type { DingTalkConfig } from '../types.js';
import { getAccessToken } from '../api/token.js';

/** Onboarding 上下文 */
interface OnboardingContext {
  prompt: (message: string) => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
  select: <T extends string>(message: string, options: Array<{ value: T; label: string }>) => Promise<T>;
  log: {
    info: (message: string) => void;
    success: (message: string) => void;
    error: (message: string) => void;
  };
  setConfig: (path: string, value: unknown) => void;
  getConfig: (path: string) => unknown;
}

/**
 * 运行 Onboarding 向导
 * @param ctx Onboarding 上下文
 */
export async function runOnboardingWizard(ctx: OnboardingContext): Promise<void> {
  ctx.log.info('欢迎使用 DingTalk Channel 配置向导！');
  ctx.log.info('');

  // 1. 获取 Client ID
  const clientId = await ctx.prompt('请输入钉钉应用的 AppKey (Client ID):');
  if (!clientId.trim()) {
    ctx.log.error('Client ID 不能为空');
    return;
  }

  // 2. 获取 Client Secret
  const clientSecret = await ctx.prompt('请输入钉钉应用的 AppSecret (Client Secret):');
  if (!clientSecret.trim()) {
    ctx.log.error('Client Secret 不能为空');
    return;
  }

  // 3. 验证凭证
  ctx.log.info('正在验证凭证...');
  try {
    await getAccessToken({ clientId, clientSecret } as DingTalkConfig);
    ctx.log.success('凭证验证成功！');
  } catch (error) {
    ctx.log.error(`凭证验证失败: ${error instanceof Error ? error.message : error}`);
    const continueAnyway = await ctx.confirm('是否继续配置（不推荐）？');
    if (!continueAnyway) return;
  }

  // 4. Robot Code
  const robotCode = await ctx.prompt('请输入机器人代码 (Robot Code，可选，直接回车跳过):');

  // 5. 消息类型
  const messageType = await ctx.select('选择消息类型:', [
    { value: 'card', label: 'AI Card (推荐) - 真流式打字机效果' },
    { value: 'markdown', label: 'Markdown - 富文本格式' },
    { value: 'text', label: 'Text - 纯文本' },
  ]);

  // 6. 私聊策略
  const dmPolicy = await ctx.select('选择私聊策略:', [
    { value: 'open', label: 'Open - 所有人都可以私聊' },
    { value: 'pairing', label: 'Pairing - 显示 staffId 让用户添加' },
    { value: 'allowlist', label: 'Allowlist - 仅允许列表中的用户' },
  ]);

  // 7. 群聊策略
  const groupPolicy = await ctx.select('选择群聊策略:', [
    { value: 'open', label: 'Open - 所有群都可以使用' },
    { value: 'allowlist', label: 'Allowlist - 仅允许列表中的群' },
  ]);

  // 8. 启用会话命令
  const enableSessionCommands = await ctx.confirm('是否启用会话命令 (/new, /reset)？');

  // 9. 启用媒体上传
  const enableMediaUpload = await ctx.confirm('是否启用媒体自动上传？');

  // 10. 保存配置
  ctx.setConfig('channels.dingtalk.enabled', true);
  ctx.setConfig('channels.dingtalk.clientId', clientId.trim());
  ctx.setConfig('channels.dingtalk.clientSecret', clientSecret.trim());

  if (robotCode.trim()) {
    ctx.setConfig('channels.dingtalk.robotCode', robotCode.trim());
  }

  ctx.setConfig('channels.dingtalk.messageType', messageType);
  ctx.setConfig('channels.dingtalk.dmPolicy', dmPolicy);
  ctx.setConfig('channels.dingtalk.groupPolicy', groupPolicy);
  ctx.setConfig('channels.dingtalk.enableSessionCommands', enableSessionCommands);
  ctx.setConfig('channels.dingtalk.enableMediaUpload', enableMediaUpload);
  ctx.setConfig('channels.dingtalk.showThinking', true);
  ctx.setConfig('channels.dingtalk.sessionTimeout', 30 * 60 * 1000);

  ctx.log.success('');
  ctx.log.success('配置完成！');
  ctx.log.info('');
  ctx.log.info('下一步：');
  ctx.log.info('1. 运行 `openclaw gateway` 启动服务');
  ctx.log.info('2. 在钉钉中找到机器人开始对话');
  ctx.log.info('');

  if (dmPolicy === 'allowlist') {
    ctx.log.info('提示：您选择了 allowlist 策略');
    ctx.log.info('首次私聊机器人时会返回您的 staffId');
    ctx.log.info('将其添加到 channels.dingtalk.allowFrom 数组中即可');
  }
}

/**
 * 导出 Onboarding 入口
 */
export const onboarding = {
  async run(ctx: OnboardingContext): Promise<void> {
    return runOnboardingWizard(ctx);
  },
};

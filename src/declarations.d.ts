/**
 * Type Declarations
 * 第三方模块类型声明
 */

// OpenClaw Plugin SDK
declare module 'openclaw/plugin-sdk' {
  export interface OpenClawPluginApi {
    runtime: unknown;
    logger?: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      debug: (...args: unknown[]) => void;
    };
    registerChannel: (options: { plugin: unknown }) => void;
    registerGatewayMethod: (
      name: string,
      handler: (ctx: {
        respond: (ok: boolean, data: unknown) => void;
        cfg: unknown;
        params?: Record<string, unknown>;
        log?: unknown;
      }) => Promise<void>
    ) => void;
  }

  export function emptyPluginConfigSchema(): unknown;
  export function buildChannelConfigSchema(schema: unknown): unknown;
}

// fluent-ffmpeg
declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    screenshots(options: {
      count: number;
      folder: string;
      filename: string;
      timemarks: string[];
      size: string;
    }): FfmpegCommand;
    on(event: 'end', callback: () => void): FfmpegCommand;
    on(event: 'error', callback: (err: Error) => void): FfmpegCommand;
  }

  interface Ffmpeg {
    (input: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
    ffprobe(
      file: string,
      callback: (
        err: Error | null,
        metadata: {
          format?: { duration?: number };
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
          }>;
        }
      ) => void
    ): void;
  }

  const ffmpeg: Ffmpeg;
  export default ffmpeg;
}

// @ffmpeg-installer/ffmpeg
declare module '@ffmpeg-installer/ffmpeg' {
  export const path: string;
}

// dingtalk-stream
declare module 'dingtalk-stream' {
  export const TOPIC_ROBOT: string;

  export class DWClient {
    constructor(options: {
      clientId: string;
      clientSecret: string;
      debug?: boolean;
      keepAlive?: boolean;
    });

    connect(): Promise<void>;
    registerCallbackListener(
      topic: string,
      callback: (res: { headers?: { messageId?: string }; data: string }) => Promise<void>
    ): void;
    socketCallBackResponse(messageId: string, response: { success: boolean }): void;
  }
}

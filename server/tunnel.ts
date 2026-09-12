import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { AppError } from "./client.js";
import type { Store, Session } from "./store.js";
import type { TunnelConfig, TunnelStatus } from "../shared/tunnel.js";

const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      tunnelId: z.string().regex(/^tunnel_[a-z0-9]{32}$/),
      apiKey: z.string().min(20).max(4096).regex(/^\S+$/).optional(),
    })
    .strict(),
  z.object({ action: z.enum(["start", "stop", "delete"]) }).strict(),
]);
export interface TunnelOptions {
  enabled?: boolean;
  binary?: string;
  mcpPort?: number;
  healthPort?: number;
  // Test injection only; never accepted from HTTP requests.
  launch?: (env: NodeJS.ProcessEnv) => ChildProcess;
  probe?: () => Promise<{ code: number; lastPoll: number }>;
}
export class TunnelManager {
  readonly available: boolean;
  private child?: ChildProcess;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private failure = "";
  private startedAt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private readonly launch: (env: NodeJS.ProcessEnv) => ChildProcess;
  private readonly probe: () => Promise<{ code: number; lastPoll: number }>;
  constructor(
    private store: Store,
    private options: TunnelOptions = {},
  ) {
    const binary =
      options.binary ??
      process.env.TUNNEL_CLIENT_PATH ??
      "/usr/local/bin/tunnel-client";
    this.available =
      !!options.enabled && (!!options.launch || existsSync(binary));
    this.launch =
      options.launch ??
      ((env) => spawn(binary, ["run"], { env, stdio: "ignore", shell: false }));
    this.probe =
      options.probe ??
      (async () => {
        const response = await fetch(
          `http://127.0.0.1:${options.healthPort ?? 18080}/readyz`,
          {
            signal: AbortSignal.timeout(1500),
            redirect: "error",
          },
        );
        await response.body?.cancel();
        const metrics = await fetch(
          `http://127.0.0.1:${options.healthPort ?? 18080}/metrics`,
          {
            signal: AbortSignal.timeout(1500),
            redirect: "error",
          },
        );
        if (!metrics.ok) {
          await metrics.body?.cancel();
          throw new Error("Metrics unavailable");
        }
        const reader = metrics.body!.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1024 * 1024) throw new Error("Metrics too large");
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const text = Buffer.concat(chunks).toString("utf8");
        const match = text.match(
          /^commands_poll_last_successful_timestamp_seconds(?:\{[^\n]*\})?\s+([0-9.eE+-]+)\s*$/m,
        );
        const lastPoll = match ? Number(match[1]) * 1000 : 0;
        return {
          code: response.status,
          lastPoll: Number.isFinite(lastPoll) ? lastPoll : 0,
        };
      });
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
  async startSaved() {
    return this.serial(async () => {
      if (this.available && this.store.tunnelConfig()?.enabled)
        this.startProcess();
    });
  }
  assertOwner(account: Session) {
    if (account.demo || account.uid.startsWith("__"))
      throw new AppError("DEMO_READONLY", "演示账号不能配置 Tunnel", 403);
    const owner = this.store.tunnelConfig()?.ownerUid;
    if (owner && owner !== account.uid)
      throw new AppError(
        "TUNNEL_OWNER",
        "Tunnel 由其他账号管理，请使用原账号删除配置后再切换",
        403,
      );
    const bound = this.store.mcpAccount();
    if (bound && bound.uid !== account.uid)
      throw new AppError("MCP_ACCOUNT_CONFLICT", "MCP 已连接其他账号", 409);
  }
  async command(account: Session, input: unknown) {
    const command = commandSchema.parse(input);
    return this.serial(async () => {
      this.assertOwner(account);
      if (this.closed)
        throw new AppError("TUNNEL_CLOSED", "服务正在关闭，请稍后重试", 503);
      const saved = this.store.tunnelConfig();
      if (command.action === "save" || command.action === "start") {
        if (!this.available)
          throw new AppError(
            "TUNNEL_UNAVAILABLE",
            "当前部署不支持网页管理 Tunnel，请使用包含客户端的镜像并启用 MCP",
            409,
          );
        if (this.store.mcpAccount()?.uid !== account.uid)
          throw new AppError(
            "MCP_NOT_CONNECTED",
            "请先连接当前账号到 MCP",
            409,
          );
        let next: TunnelConfig;
        if (command.action === "save") {
          const apiKey = command.apiKey ?? saved?.apiKey;
          if (!apiKey)
            throw new AppError(
              "TUNNEL_KEY_REQUIRED",
              "首次配置需要填写运行密钥",
              400,
            );
          next = {
            ownerUid: account.uid,
            tunnelId: command.tunnelId,
            apiKey,
            enabled: true,
          };
        } else {
          if (!saved)
            throw new AppError(
              "TUNNEL_NOT_CONFIGURED",
              "请先保存 Tunnel 配置",
              409,
            );
          next = { ...saved, enabled: true };
        }
        await this.stopProcess();
        this.store.saveTunnelConfig(next);
        this.retries = 0;
        this.startProcess();
      } else {
        await this.stopProcess();
        if (command.action === "delete") this.store.saveTunnelConfig(undefined);
        else if (saved)
          this.store.saveTunnelConfig({ ...saved, enabled: false });
      }
      // Readiness is checked separately. Saving never claims a successful connection.
      return { ok: true };
    });
  }
  private startProcess() {
    const config = this.store.tunnelConfig();
    if (this.closed || !this.available || !config?.enabled || this.child)
      return;
    this.failure = "";
    this.startedAt = Date.now();
    try {
      const child = this.launch({
        PATH: process.env.PATH,
        HOME: "/tmp",
        SSL_CERT_FILE: process.env.SSL_CERT_FILE,
        CONTROL_PLANE_API_KEY: config.apiKey,
        CONTROL_PLANE_TUNNEL_ID: config.tunnelId,
        MCP_SERVER_URL: `http://127.0.0.1:${this.options.mcpPort ?? 3002}/mcp`,
        HEALTH_LISTEN_ADDR: `127.0.0.1:${this.options.healthPort ?? 18080}`,
        LOG_LEVEL: "error",
        LOG_FORMAT: "json",
      });
      this.child = child;
      let ended = false;
      const finish = () => {
        if (ended || this.child !== child) return;
        ended = true;
        this.child = undefined;
        this.failure =
          "Tunnel 客户端退出，请检查运行密钥、网络及部署环境后重试";
        if (!this.closed && this.retries < 5) {
          this.retry = setTimeout(
            () => {
              void this.serial(async () => this.startProcess());
            },
            Math.min(30000, 1000 * 2 ** this.retries++),
          );
          this.retry.unref();
        }
      };
      child.once("error", finish);
      child.once("exit", finish);
    } catch {
      this.failure = "无法启动 Tunnel 客户端，请检查部署环境";
    }
  }
  private async stopProcess() {
    clearTimeout(this.retry);
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once("exit", done);
      child.once("error", done);
      child.kill("SIGTERM");
    });
  }
  async status(account: Session): Promise<TunnelStatus> {
    const saved = this.store.tunnelConfig();
    const locked =
      !!account.demo ||
      (!!saved && saved.ownerUid !== account.uid) ||
      (!!this.store.mcpAccount() &&
        this.store.mcpAccount()?.uid !== account.uid);
    const base = {
      available: this.available,
      locked,
      configured: !locked && !!saved,
      enabled: !locked && !!saved?.enabled,
      tunnelId: !locked ? (saved?.tunnelId ?? "") : "",
      hasKey: !locked && !!saved?.apiKey,
      checkedAt: new Date().toISOString(),
      lastPollAt: null as string | null,
    };
    const result = (
      state: TunnelStatus["state"],
      message: string,
    ): TunnelStatus => ({ ...base, state, message });
    if (locked)
      return result(
        "unavailable",
        account.demo ? "演示账号不能配置 Tunnel" : "Tunnel 由其他账号管理",
      );
    if (!this.available)
      return result(
        "unavailable",
        "网页管理未启用，或镜像中缺少 Tunnel 客户端；独立部署的 Tunnel 请在服务器管理",
      );
    if (!saved)
      return result(
        "unconfigured",
        "填写 Tunnel ID 和运行密钥，保存后开始连接",
      );
    if (!saved.enabled) return result("stopped", "Tunnel 已停用，配置已保留");
    if (this.failure) return result("error", this.failure);
    const child = this.child;
    if (!child) return result("connecting", "正在启动 Tunnel 客户端");
    try {
      const { code, lastPoll } = await this.probe();
      // A probe from a replaced process must not report the new process ready.
      if (this.child !== child || this.store.tunnelConfig()?.enabled !== true)
        return result("connecting", "状态已变化，请刷新");
      const fresh =
        lastPoll >= this.startedAt - 1000 &&
        lastPoll <= Date.now() + 5000 &&
        Date.now() - lastPoll < 90000;
      if (lastPoll > 0 && lastPoll <= Date.now() + 5000)
        base.lastPollAt = new Date(lastPoll).toISOString();
      if (code === 200 && fresh) {
        this.retries = 0;
        return result(
          "ready",
          "Tunnel 已就绪，本地 MCP 和近期 OpenAI 轮询均正常；请在 ChatGPT 中添加连接",
        );
      }
      return result(
        Date.now() - this.startedAt < 75000 ? "connecting" : "error",
        code === 200
          ? "本地 MCP 已就绪，尚未收到近期成功的 OpenAI 轮询。请核对密钥的 Tunnels Read + Use 权限、Tunnel ID 和出站网络"
          : `本地 MCP 尚未就绪（HTTP ${code}），请稍后重试并检查部署`,
      );
    } catch {
      return result(
        Date.now() - this.startedAt < 75000 ? "connecting" : "error",
        "尚未收到 Tunnel 就绪响应，请稍后刷新；持续异常时检查部署和网络",
      );
    }
  }
  async close() {
    this.closed = true;
    return this.serial(async () => this.stopProcess());
  }
}

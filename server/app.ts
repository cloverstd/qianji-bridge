import { createAccountService, filterSchema } from "./account-service.js";
import { TunnelManager, type TunnelOptions } from "./tunnel.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { Store, type Session } from "./store.js";
import { AppError, QianjiClient, md5, type Client } from "./client.js";
import { AccountLocks } from "./sync.js";
import { filterBills, exportCsv, publicBill } from "./domain.js";
import { demoSnapshot } from "./demo.js";
import type { Filters, Raw } from "../shared/types.js";

declare module "fastify" {
  interface FastifyRequest {
    account: Session;
  }
}
export interface AppOptions {
  directory?: string;
  secret?: string;
  client?: Client;
  origins?: string[];
  secure?: boolean;
  demo?: boolean;
  serveStatic?: boolean;
  mcpEnabled?: boolean;
  rateLimitMax?: number;
  tunnel?: TunnelOptions;
}
export async function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  const store = new Store(
    options.directory ?? process.env.DATA_DIR ?? "data",
    options.secret ?? process.env.SESSION_KEY,
  );
  const client = options.client ?? new QianjiClient(),
    locks = new AccountLocks();
  const origins = options.origins ?? [
    process.env.APP_ORIGIN ?? "http://localhost:3001",
    ...(process.env.NODE_ENV !== "production"
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : []),
  ];
  const secure = options.secure ?? process.env.COOKIE_SECURE === "true";
  const demo = options.demo ?? process.env.ENABLE_DEMO !== "false";
  if (
    process.env.NODE_ENV === "production" &&
    origins.some((o) => o.startsWith("https:")) &&
    !secure
  )
    throw new Error("HTTPS 部署必须设置 COOKIE_SECURE=true");
  await app.register(cookie);
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 180,
    timeWindow: "1 minute",
  });
  const tunnel = new TunnelManager(store, {
    enabled:
      (options.mcpEnabled ?? process.env.ENABLE_MCP === "true") &&
      process.env.ENABLE_MANAGED_TUNNEL !== "false",
    mcpPort: Number(process.env.MCP_PORT ?? 3002),
    ...options.tunnel,
  });
  app.addHook("onReady", async () => tunnel.startSaved());
  app.addHook("onClose", async () => {
    await tunnel.close();
    store.close();
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    const path = decodeURIComponent(req.url.split("?")[0]!);
    if (!path.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!req.headers.origin || !origins.includes(req.headers.origin))
        throw new AppError(
          "ORIGIN",
          "请求来源不匹配，请使用配置的访问地址",
          403,
        );
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AppError("CONTENT_TYPE", "请求必须使用 JSON", 415);
    }
    const pathname = path;
    if (
      [
        "/api/auth/login",
        "/api/auth/demo",
        "/api/auth/session",
        "/api/health",
      ].includes(pathname!)
    )
      return;
    const s = store.session(req.cookies.qianji_session);
    if (!s) throw new AppError("UNAUTHORIZED", "请先登录", 401);
    req.account = s;
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        code: "VALIDATION",
        message: "输入格式不正确",
        details: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (error instanceof AppError)
      return reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({
      code: "SERVER_ERROR",
      message:
        status === 429
          ? "请求过于频繁，请稍后再试"
          : status >= 500
            ? "服务处理失败，请检查配置后重试"
            : "请求格式不正确",
    });
  });
  const setCookie = (reply: any, s: Session) =>
    reply.setCookie("qianji_session", store.createSession(s), {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: 7 * 86400,
    });
  const snap = (s: Session) => store.snapshot(s.uid);
  const service = createAccountService(store, client, locks);
  app.get("/api/health", async () => ({ ok: true }));
  app.all("/mcp", async (_req, reply) =>
    reply.code(404).send({ message: "MCP 仅通过内部 tunnel 入口提供" }),
  );
  app.get("/api/auth/session", async (req) => {
    const s = store.session(req.cookies.qianji_session);
    return {
      authenticated: !!s,
      user: s?.user,
      demo: !!s?.demo,
      demoAvailable: demo,
    };
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, password } = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(1024),
        })
        .parse(req.body);
      const devid = store.device(email);
      const result = await client.call(
        "/account/login",
        { v: email, pwd: md5(password) },
        { uid: "", token: "", devid, user: {} },
      );
      if (
        !result?.user?.id ||
        typeof result.token !== "string" ||
        !result.token ||
        String(result.user.id).startsWith("__")
      )
        throw new AppError("LOGIN_RESPONSE", "登录响应不完整", 502);
      if (req.cookies.qianji_session) store.logout(req.cookies.qianji_session);
      const s = {
        uid: String(result.user.id),
        token: result.token,
        devid,
        user: {
          id: String(result.user.id),
          name: result.user.name,
          email: result.user.email,
        },
      };
      if (store.mcpAccount()?.uid === s.uid) store.connectMcp(s);
      setCookie(reply, s);
      return { authenticated: true, user: s.user, demo: false };
    },
  );
  app.post("/api/auth/demo", async (req, reply) => {
    if (!demo) throw new AppError("DEMO_DISABLED", "演示模式未开启", 404);
    const data = demoSnapshot();
    store.save("__demo__", data);
    if (req.cookies.qianji_session) store.logout(req.cookies.qianji_session);
    setCookie(reply, {
      uid: "__demo__",
      devid: "demo",
      token: "",
      user: data.user,
      demo: true,
    });
    return { authenticated: true, user: data.user, demo: true };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    store.logout(req.cookies.qianji_session!);
    reply.clearCookie("qianji_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/bootstrap", async (req) => service.bootstrap(req.account));
  app.post("/api/sync", async (req) => service.sync(req.account, req.body));
  const filters = (query: unknown) => filterSchema.parse(query);
  app.get("/api/bills", async (req) => service.bills(req.account, req.query));
  app.get("/api/bills/export", async (req, reply) => {
    const f = filters(req.query),
      list = filterBills(snap(req.account), f as unknown as Filters).map(
        publicBill,
      );
    const format = f.format ?? "csv";
    reply.header(
      "Content-Disposition",
      `attachment; filename="qianji-bills.${format}"`,
    );
    return format === "csv"
      ? reply.type("text/csv; charset=utf-8").send(exportCsv(list))
      : reply.type("application/json").send(JSON.stringify(list, null, 2));
  });
  app.get<{ Params: { id: string } }>("/api/bills/:id", async (req) =>
    service.bill(req.account, req.params.id),
  );
  app.get("/api/statistics", async (req) =>
    service.stats(req.account, req.query),
  );
  app.get("/api/budgets", async (req) =>
    service.budgets(req.account, req.query),
  );
  app.get<{ Params: { kind: string }; Querystring: Raw }>(
    "/api/resources/:kind",
    async (req) => service.resources(req.account, req.params.kind, req.query),
  );
  app.get("/api/settings", async (req) => service.settings(req.account));
  app.get("/api/settings/tunnel", async (req) => tunnel.status(req.account));
  app.post(
    "/api/settings/tunnel",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => tunnel.command(req.account, req.body),
  );
  app.get("/api/settings/mcp", async (req) => ({
    available: options.mcpEnabled ?? process.env.ENABLE_MCP === "true",
    connected: store.mcpAccount()?.uid === req.account.uid,
    anotherAccountConnected:
      !!store.mcpAccount() && store.mcpAccount()?.uid !== req.account.uid,
  }));
  app.post("/api/settings/mcp", async (req) => {
    const { connected } = z
      .object({ connected: z.boolean() })
      .strict()
      .parse(req.body);
    if (connected) {
      if (!(options.mcpEnabled ?? process.env.ENABLE_MCP === "true"))
        throw new AppError("MCP_DISABLED", "服务器未启用 MCP", 409);
      if (req.account.demo)
        throw new AppError("DEMO_READONLY", "演示账号不能连接 MCP", 403);
      if (store.mcpAccount() && store.mcpAccount()?.uid !== req.account.uid)
        throw new AppError(
          "MCP_ACCOUNT_CONFLICT",
          "MCP 已连接其他账号，请先使用该账号断开连接",
          409,
        );
      tunnel.assertOwner(req.account);
      store.connectMcp(req.account);
    } else store.disconnectMcp(req.account.uid);
    return { connected: store.mcpAccount()?.uid === req.account.uid };
  });
  app.post("/api/settings/test-book", async (req) => {
    if (req.account.demo)
      throw new AppError("DEMO_READONLY", "请使用真实账号指定测试账本", 403);
    const { bookid } = z.object({ bookid: z.string() }).parse(req.body);
    if (!snap(req.account).books.some((b) => b.bookid === bookid))
      throw new AppError("BOOK", "测试账本不存在");
    const settings = store.settings(req.account.uid);
    store.saveSettings(req.account.uid, { ...settings, testBookid: bookid });
    return { ok: true };
  });
  app.post("/api/writes", async (req) => service.write(req.account, req.body));
  app.post<{ Params: { id: string } }>(
    "/api/writes/:id/reconcile",
    async (req) => service.reconcile(req.account, req.params.id),
  );
  app.post<{ Params: { id: string } }>("/api/writes/:id/resolve", async (req) =>
    locks.run(req.account.uid, async () => {
      z.object({ confirmedNotApplied: z.literal(true) })
        .strict()
        .parse(req.body);
      const op = store.operation(req.account.uid, req.params.id);
      if (!op || !["pending", "uncertain"].includes(op.public.status))
        throw new AppError("OPERATION_STATE", "该写入无需人工处理", 409);
      op.public = {
        ...op.public,
        status: "dismissed",
        message: "已由用户在钱迹核实未发生；该请求不会重新发送",
      };
      store.saveOperation(req.account.uid, req.params.id, op);
      return op.public;
    }),
  );
  if (options.serveStatic !== false && existsSync(resolve("dist/index.html"))) {
    await app.register(staticPlugin, { root: resolve("dist") });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ message: "接口不存在" })
        : reply.sendFile("index.html"),
    );
  }
  return { app, store, service, tunnel };
}

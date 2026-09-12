import { createHash } from "node:crypto";
import { parseUpstream } from "./domain.js";
import type { Raw } from "../shared/types.js";
import type { Session } from "./store.js";
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
  }
}
export const md5 = (s: string) => createHash("md5").update(s).digest("hex");
export const profile: Record<string, string> = {
  pkg: "com.mutangtech.qianji",
  vs: "1207",
  vsn: "4.5.1b3",
  os: "1",
  osvs: "36",
  clang: "zh",
  cregion: "CN",
  timezoneoffset: "28800",
  mk: "beta",
  devbrand: "QianjiWeb",
  devname: "QianjiWeb",
};
export function signature(path: string, ms: number) {
  const parts = path.split("/");
  if (parts.length !== 3 || !parts[1] || !parts[2])
    throw new AppError("SIGNATURE", "接口路径必须恰好两段");
  const [, ctrl, act] = parts as [string, string, string];
  const reqidv2 = md5(
    profile.pkg +
      String(ms + Number(profile.vs) + 9081127) +
      ctrl +
      act +
      "free20170908&x_*1127",
  );
  return {
    ctrl,
    act,
    reqidv2,
    tok: md5(
      reqidv2 + "1172020" + ctrl + md5(reqidv2 + "michaeljackson") + act,
    ),
  };
}
export interface Client {
  call(path: string, body: Raw, session?: Session): Promise<any>;
}
export class QianjiClient implements Client {
  last = new Map<string, number>();
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  async call(path: string, body: Raw = {}, session?: Session) {
    const ms = Math.max(this.now(), (this.last.get(path) ?? 0) + 1);
    this.last.set(path, ms);
    const headers: Record<string, string> = {
      ...profile,
      ...signature(path, ms),
      "Content-Type": "application/x-www-form-urlencoded",
      devid: session?.devid ?? "",
    };
    if (session?.token) headers.utoken = session.token;
    if (["/syncv2/pull", "/bill/syncall", "/tag/list"].includes(path))
      headers.htoken = "1";
    const fields = session?.uid
      ? { ...body, uid: session.uid, fr: session.uid }
      : body;
    let response: Response;
    try {
      response = await this.fetcher("https://api.qianjiapp.com" + path, {
        method: "POST",
        headers,
        body: new URLSearchParams(
          Object.entries(fields).map(([k, v]) => [k, String(v)]),
        ),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new AppError(
        "UPSTREAM_UNCERTAIN",
        "钱迹连接超时或中断，请重试查询；已提交的写入需先核查结果",
        502,
      );
    }
    if (!response.ok)
      throw new AppError(
        "UPSTREAM_HTTP",
        `钱迹服务暂不可用（HTTP ${response.status}）`,
        502,
      );
    let data: Raw;
    try {
      data = parseUpstream(await response.text());
    } catch {
      throw new AppError("UPSTREAM_FORMAT", "钱迹返回了无法解析的数据", 502);
    }
    if (Number(data.ec) !== 200) {
      const ec = Number(data.ec);
      const messages: Record<number, string> = {
        8888: "登录失败，请核对邮箱和密码或重新登录",
        400404: "钱迹签名校验失败，请检查服务器时间和协议版本",
        9002: "钱迹拒绝了请求参数，当前操作未完成",
        5: "钱迹接口不存在或已变更",
      };
      // Never forward upstream arbitrary text: it may contain private data or tokens.
      throw new AppError(
        "QIANJI_" + ec,
        messages[ec] ?? `钱迹返回业务错误（${ec}）`,
        ec === 8888 ? 401 : 502,
      );
    }
    return data.data;
  }
}
export function requireList(data: Raw, field = "list"): Raw[] {
  if (
    !data ||
    !Array.isArray(data[field]) ||
    data[field].some(
      (x: unknown) => !x || typeof x !== "object" || Array.isArray(x),
    )
  )
    throw new AppError(
      "UPSTREAM_STRUCTURE",
      "接口数据结构尚未确认，不能判断为空数据",
      502,
    );
  return data[field];
}

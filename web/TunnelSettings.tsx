import { useEffect, useRef, useState } from "react";
import { api, useRemote } from "./api";
import { Field, Notice } from "./ui";
import type { TunnelStatus } from "../shared/tunnel";
const states: Record<TunnelStatus["state"], string> = {
  unavailable: "不可用",
  unconfigured: "未配置",
  stopped: "已停用",
  connecting: "连接中",
  ready: "已就绪",
  error: "连接异常",
};
export function TunnelSettings({
  version,
  connected,
  demo,
}: {
  version: number;
  connected: boolean;
  demo: boolean;
}) {
  const [tick, setTick] = useState(0);
  const remote = useRemote<TunnelStatus>("/settings/tunnel", version + tick);
  const [tunnelId, setTunnelId] = useState(""),
    [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (remote.data && !initialized.current) {
      setTunnelId(remote.data.tunnelId);
      initialized.current = true;
    }
  }, [remote.data]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  const status = remote.data;
  const locked = busy || demo || !status || status.locked;
  async function send(action: "save" | "start" | "stop" | "delete") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(
        "/settings/tunnel",
        action === "save"
          ? { action, tunnelId: tunnelId.trim(), ...(apiKey ? { apiKey } : {}) }
          : { action },
      );
      setApiKey("");
      if (action === "delete") {
        setTunnelId("");
        setConfirmDelete(false);
      }
      setNotice(
        action === "save"
          ? "配置已加密保存，正在尝试连接。请查看下方状态。"
          : action === "delete"
            ? "配置已删除，Tunnel 已停止。"
            : action === "stop"
              ? "Tunnel 已停止，配置已保留。"
              : "已请求重新连接，请查看下方状态。",
      );
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tunnel-settings">
      <h3>OpenAI Tunnel</h3>
      <p className="muted">
        在这里配置服务器到 ChatGPT 的连接。先绑定上方钱迹账号，再填写 Tunnel
        信息。
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {remote.error && (
        <Notice kind="error">无法读取最新状态：{remote.error}</Notice>
      )}
      <dl className="detail-list" aria-live="polite">
        <dt>Tunnel 状态</dt>
        <dd>
          {remote.error ? "状态未知" : status ? states[status.state] : "读取中"}
        </dd>
        <dt>运行密钥</dt>
        <dd>{status?.hasKey ? "已加密保存（不回显）" : "未配置"}</dd>
        <dt>最近成功轮询</dt>
        <dd>
          {status?.lastPollAt
            ? new Date(status.lastPollAt).toLocaleString("zh-CN")
            : "尚无记录"}
        </dd>
        <dt>最近检查</dt>
        <dd>
          {status
            ? new Date(status.checkedAt).toLocaleTimeString("zh-CN")
            : "—"}
        </dd>
      </dl>
      {!remote.error && status && (
        <Notice kind={status.state === "error" ? "error" : "info"}>
          {status.message}
        </Notice>
      )}
      <form
        className="tunnel-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send("save");
        }}
      >
        <Field label="Tunnel ID">
          <input
            value={tunnelId}
            onChange={(e) => setTunnelId(e.target.value)}
            placeholder="tunnel_…"
            required
            pattern="tunnel_[a-z0-9]{32}"
            maxLength={39}
            disabled={locked || !status?.available}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Tunnel 运行密钥">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              status?.hasKey
                ? "留空保留已有密钥；填写则替换"
                : "填写具备 Tunnels Read + Use 权限的密钥"
            }
            required={!status?.hasKey}
            minLength={20}
            maxLength={4096}
            disabled={locked || !status?.available}
            autoComplete="new-password"
          />
        </Field>
        <p className="muted">
          密钥仅在保存时发送到服务器并加密存储。无需填写 ChatGPT 密码或 Cookie。
        </p>
        {!connected && !demo && (
          <p className="muted">请先点击上方「连接当前账号到 MCP」。</p>
        )}
        <div className="tunnel-actions">
          <button
            className="primary"
            disabled={locked || !status?.available || !connected}
          >
            {busy ? "处理中…" : "保存并连接 Tunnel"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={
              locked || !status?.available || !status?.configured || !connected
            }
            onClick={() => void send("start")}
          >
            重新连接
          </button>
          <button
            type="button"
            className="secondary"
            disabled={locked || !status?.enabled}
            onClick={() => void send("stop")}
          >
            停用 Tunnel
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setTick((t) => t + 1)}
          >
            刷新状态
          </button>
          <button
            type="button"
            className="secondary"
            disabled={locked || !status?.configured}
            onClick={() => setConfirmDelete(true)}
          >
            删除 Tunnel 配置
          </button>
        </div>
      </form>
      {confirmDelete && (
        <div className="notice">
          <span>
            删除将停止 Tunnel 并移除当前保存的密钥；以后连接需重新填写。
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void send("delete")}
          >
            确认删除配置
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            取消
          </button>
        </div>
      )}
      <details className="tunnel-help">
        <summary>获取 Tunnel ID，并在 ChatGPT 中添加钱迹</summary>
        <ol>
          <li>
            打开{" "}
            <a
              href="https://platform.openai.com/settings/organization/tunnels"
              target="_blank"
              rel="noreferrer"
            >
              OpenAI Tunnels 设置
            </a>
            ，创建 Tunnel 并关联目标 ChatGPT 工作区，准备具备 Tunnels Read + Use
            权限的运行密钥。
          </li>
          <li>在此保存配置，等待 Tunnel 状态显示「已就绪」。</li>
          <li>
            在 ChatGPT 设置的 Security and login 中启用 Developer mode，然后打开{" "}
            <a
              href="https://chatgpt.com/plugins"
              target="_blank"
              rel="noreferrer"
            >
              ChatGPT Plugins
            </a>
            ，点击加号，名称填写「钱迹」。
          </li>
          <li>
            Connection 选择 Tunnel，选择或填写相同 Tunnel ID，身份验证选择 No
            authentication。创建后应发现 15 个工具。
          </li>
          <li>
            在新对话中启用钱迹，尝试「查看本月分类支出」。开发者模式及 Tunnel
            列表受账号和工作区权限影响。
          </li>
        </ol>
        <p className="muted">
          「已就绪」表示本地 MCP 和近期 OpenAI 轮询正常；ChatGPT
          是否已添加插件、是否成功调用，需要在 ChatGPT 中验证。网页不会自动创建
          ChatGPT 插件。
        </p>
      </details>
    </div>
  );
}

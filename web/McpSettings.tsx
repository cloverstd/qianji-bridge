import { useState } from "react";
import { Plug } from "lucide-react";
import { api, useRemote } from "./api";
import { Notice } from "./ui";
export function McpSettings({
  version,
  demo,
  onDone,
}: {
  version: number;
  demo: boolean;
  onDone: () => void;
}) {
  const remote = useRemote("/settings/mcp", version);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      await api("/settings/mcp", { connected: !remote.data?.connected });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel span-two">
      <div className="panel-heading">
        <h2>ChatGPT / MCP</h2>
        <Plug size={20} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {remote.error && <Notice kind="error">{remote.error}</Notice>}
      <p className="muted">
        通过 OpenAI Secure MCP Tunnel，在 ChatGPT
        中查询账单、分析收支和使用已验证的账单操作。
      </p>
      <dl className="detail-list">
        <dt>服务器</dt>
        <dd>
          {!remote.data
            ? "读取中"
            : remote.data.available
              ? "MCP 已启用"
              : "MCP 未启用"}
        </dd>
        <dt>当前账号</dt>
        <dd>{remote.data?.connected ? "已连接 MCP" : "未连接"}</dd>
      </dl>
      {remote.data?.anotherAccountConnected && (
        <Notice kind="error">
          服务器 MCP 已连接其他账号，请先用该账号断开。
        </Notice>
      )}
      <button
        className={remote.data?.connected ? "secondary" : "primary"}
        disabled={
          busy ||
          demo ||
          !remote.data?.available ||
          remote.data?.anotherAccountConnected
        }
        onClick={toggle}
      >
        {busy
          ? "处理中…"
          : remote.data?.connected
            ? "断开 MCP 连接"
            : "连接当前账号到 MCP"}
      </button>
      <p className="footnote">
        连接后，允许使用该 tunnel 的 ChatGPT
        工作区可访问此账号的数据和已验证的写入工具。MCP
        不另设密码；钱迹登录凭证仅加密保存于服务器。退出网页不影响
        MCP，需要停止访问时请在这里断开。钱迹凭证过期后重新登录即可更新。
      </p>
    </section>
  );
}

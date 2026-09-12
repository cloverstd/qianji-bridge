import { McpSettings } from "./McpSettings";
import { useState } from "react";
import { ShieldCheck, BookOpen, LogOut } from "lucide-react";
import type { Book, Raw } from "../shared/types";
import { api, useRemote } from "./api";
import { Notice, Field } from "./ui";
export function SettingsPage({
  bootstrap,
  version,
  onDone,
  onLogout,
}: {
  bootstrap: Raw;
  version: number;
  onDone: () => void;
  onLogout: () => void;
}) {
  const remote = useRemote("/settings", version),
    [testBook, setTestBook] = useState(bootstrap.settings.testBookid ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/settings/test-book", { bookid: testBook });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <h2>账号与同步</h2>
          <ShieldCheck size={20} />
        </div>
        <div className="account-card">
          <span className="avatar">
            {bootstrap.user.name?.slice(0, 1) ?? "钱"}
          </span>
          <div>
            <h3>{bootstrap.user.name}</h3>
            <p className="muted">{bootstrap.user.email}</p>
          </div>
        </div>
        <dl className="detail-list">
          <dt>数据模式</dt>
          <dd>{bootstrap.demo ? "独立演示数据" : "钱迹真实账号"}</dd>
          <dt>最近同步</dt>
          <dd>
            {bootstrap.lastSync
              ? new Date(bootstrap.lastSync).toLocaleString("zh-CN")
              : "尚未同步"}
          </dd>
          <dt>账单数量</dt>
          <dd>{bootstrap.billCount} 笔</dd>
          <dt>主币种</dt>
          <dd>{bootstrap.config.mcurrency ?? "CNY"}</dd>
        </dl>
        <button className="secondary" onClick={onLogout}>
          <LogOut size={16} />
          退出账号
        </button>
        <p className="footnote">
          退出会清除当前登录会话；已同步账单仍保存在你的服务器，登录原账号后可继续查看。
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>专用测试账本</h2>
          <BookOpen size={20} />
        </div>
        <p className="muted">
          请先在钱迹 App
          新建一个空白测试账本，同步后在这里指定。测试会真实修改此账本。
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="测试账本">
          <select
            aria-label="测试账本"
            value={testBook}
            onChange={(e) => setTestBook(e.target.value)}
          >
            <option value="">请选择专用测试账本</option>
            {bootstrap.books.map((b: Book) => (
              <option key={b.bookid} value={b.bookid}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          className="primary"
          disabled={busy || !testBook || bootstrap.demo}
          onClick={save}
        >
          保存测试账本
        </button>
        <p className="footnote">
          仅基准币种、无资产、无图片和手续费的普通账单可进行写入验证。每种操作单独通过后开放。
        </p>
      </section>
      <McpSettings version={version} demo={!!bootstrap.demo} onDone={onDone} />
      <section className="panel span-two">
        <div className="panel-heading">
          <h2>写入功能验证状态</h2>
          <span className="muted small">真实写入 + 回拉核验</span>
        </div>
        {remote.error && <Notice kind="error">{remote.error}</Notice>}
        <div className="capability-list">
          {(remote.data?.capabilities ?? bootstrap.capabilities).map(
            (c: Raw) => (
              <div key={c.action}>
                <strong>{c.label}</strong>
                <span
                  className={"status-pill " + (c.verified ? "verified" : "")}
                >
                  {c.verified
                    ? "已验证"
                    : c.testable
                      ? "待测试账本验证"
                      : "暂不开放"}
                </span>
                <p>{c.reason}</p>
              </div>
            ),
          )}
        </div>
      </section>
      {remote.data?.operations.length > 0 && (
        <section className="panel span-two">
          <div className="panel-heading">
            <h2>写入核查记录</h2>
          </div>
          {remote.data.operations.map((op: Raw) => (
            <div className="operation" key={op.requestId}>
              <div>
                <strong>
                  {op.status === "confirmed"
                    ? "已确认"
                    : op.status === "dismissed"
                      ? "已人工核实未发生"
                      : "结果待核查"}
                </strong>
                <p>{op.message}</p>
                <small className="muted id">{op.requestId}</small>
              </div>
              {["pending", "uncertain"].includes(op.status) && (
                <div className="inline-controls">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await api("/writes/" + op.requestId + "/reconcile", {});
                        onDone();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    核查结果
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "请先在钱迹 App 确认本次操作确实没有发生。标记后可提交新操作；本请求不会自动重发。确认已核实？",
                        )
                      )
                        return;
                      setBusy(true);
                      setError("");
                      try {
                        await api("/writes/" + op.requestId + "/resolve", {
                          confirmedNotApplied: true,
                        });
                        onDone();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    已在钱迹核实未发生
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

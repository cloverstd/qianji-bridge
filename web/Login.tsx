import React, { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LoaderCircle,
  ShieldCheck,
  Coffee,
  BookOpen,
  CircleDollarSign,
  Check,
} from "lucide-react";
import { api } from "./api";
import { Notice, Field } from "./ui";
export function Login({
  onLogin,
  demoAvailable,
}: {
  onLogin: () => void;
  demoAvailable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("/auth/login", {
        email: form.get("email"),
        password: form.get("password"),
      });
      e.currentTarget?.reset();
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <div className="brand">
          <span className="brand-mark">迹</span>钱迹 <small>WEB</small>
        </div>
        <div className="login-intro">
          <span className="eyebrow">YOUR PERSONAL LEDGER</span>
          <h1>
            每一笔，
            <br />
            都心中有数。
          </h1>
          <p>
            连接你的钱迹账本，
            <br />
            在大屏上看清生活的收支。
          </p>
          <div className="login-ledger">
            <span>
              <Coffee size={20} />
              一杯咖啡 <b>− 28.00</b>
            </span>
            <span>
              <BookOpen size={20} />
              一本好书 <b>− 48.00</b>
            </span>
            <span>
              <CircleDollarSign size={20} />
              认真生活，清晰记录 <Check size={18} />
            </span>
          </div>
        </div>
        <small>个人记账工作台 · 自部署版</small>
      </div>
      <section className="login-panel">
        <form onSubmit={login}>
          <div className="mobile-brand">钱迹 WEB</div>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>登录你的钱迹账号</h2>
          <p className="muted">使用钱迹 App 绑定的邮箱和密码</p>
          {error && <Notice kind="error">{error}</Notice>}
          <Field label="邮箱">
            <input
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
            />
          </Field>
          <Field label="密码">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="输入钱迹密码"
              required
            />
          </Field>
          <button className="primary wide" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                登录并连接 <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="privacy">
            <ShieldCheck size={16} />
            密码仅用于本次登录，不会保存在服务器。
          </p>
          {demoAvailable && (
            <>
              <div className="divider">
                <span>先看看网页版</span>
              </div>
              <button
                className="secondary wide"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("/auth/demo", {});
                    onLogin();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                体验演示账本 <ArrowUpRight size={17} />
              </button>
              <p className="small muted center">
                演示数据独立，不会连接或修改真实账本
              </p>
            </>
          )}
        </form>
        <footer>钱迹非官方网页版 · 数据保存在你自己的服务器</footer>
      </section>
    </main>
  );
}

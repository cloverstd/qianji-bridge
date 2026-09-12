import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Raw } from "../shared/types";
import { api } from "./api";
import { Loading, Notice } from "./ui";
import { Login } from "./Login";
import { Workspace } from "./Workspace";
import "./style.css";
function App() {
  const [session, setSession] = useState<Raw | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    try {
      setSession(await api("/auth/session"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const expired = () =>
      setSession({ authenticated: false, demoAvailable: true });
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function logout() {
    try {
      await api("/auth/logout", {});
      setSession({
        authenticated: false,
        demoAvailable: session?.demoAvailable ?? true,
      });
      location.hash = "";
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!session)
    return (
      <div className="initial-load">
        {error ? (
          <>
            <Notice kind="error">{error}</Notice>
            <button onClick={refresh} className="primary">
              重试连接
            </button>
          </>
        ) : (
          <Loading />
        )}
      </div>
    );
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {session.authenticated ? (
        <Workspace onLogout={logout} />
      ) : (
        <Login
          demoAvailable={session.demoAvailable !== false}
          onLogin={refresh}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

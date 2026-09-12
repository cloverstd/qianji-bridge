import React, { useEffect } from "react";
import { AlertCircle, FileText, LoaderCircle, X } from "lucide-react";
export function Notice({
  children,
  kind = "info",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={"notice " + kind}
    >
      <AlertCircle size={17} />
      <span>{children}</span>
    </div>
  );
}
export function Empty({
  text = "暂无数据",
  detail = "试试调整筛选条件，或同步最新账单。",
}: {
  text?: string;
  detail?: string;
}) {
  return (
    <div className="empty">
      <FileText size={30} />
      <strong>{text}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} />
      正在读取…
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal"
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

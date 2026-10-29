import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Brand } from "../brand/Brand";

export function AuthDialog({ view, onViewChange, onClose, children }: { view: "login" | "register" | "forgot"; onViewChange: (view: "login" | "register") => void; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (dialog.open && dialog.close) dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [view]);

  return createPortal(<dialog ref={dialogRef} className="auth-dialog" aria-modal="true" aria-labelledby="auth-panel-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key !== "Tab") return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <button type="button" className="auth-dialog-close" aria-label="关闭登录窗口" onClick={onClose}>×</button>
    <header className="auth-dialog-brand"><Brand /><p>让视频里的知识，成为你的积累。</p></header>
    {view !== "forgot" && <nav className="auth-dialog-tabs" aria-label="账号操作"><button type="button" className={view === "login" ? "is-active" : ""} aria-pressed={view === "login"} onClick={() => onViewChange("login")}>邮箱登录</button><button type="button" className={view === "register" ? "is-active" : ""} aria-pressed={view === "register"} onClick={() => onViewChange("register")}>注册账号</button></nav>}
    {children}
  </dialog>, document.body);
}

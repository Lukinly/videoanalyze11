import type { ReactNode } from "react";
import { Brand } from "../brand/Brand";

export function AuthCard({ eyebrow, title, embedded = false, children }: { eyebrow: string; title: string; embedded?: boolean; children: ReactNode }) {
  const Heading = embedded ? "h2" : "h1";
  const content = <section className="auth-card"><p className="eyebrow">{eyebrow}</p><Heading id={embedded ? "auth-panel-title" : undefined}>{title}</Heading>{children}</section>;
  return embedded ? content : <main className="auth-shell"><Brand />{content}</main>;
}

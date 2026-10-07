import type { ReactNode } from "react";
import { IconAlert, IconCheckCircle, IconInfo, IconXCircle } from "./icons";

export function Card({ title, subtitle, icon, right, children, className = "" }: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass card-glow flex flex-col rounded-2xl border border-white/70 ring-1 ring-navy-900/5 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 px-6 pt-5 pb-4">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-brand text-white shadow-lg shadow-brand-500/30">
              {icon}
            </div>
          )}
          <div>
            <h2 className="font-display text-[17px] font-semibold text-navy-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {right}
      </header>
      <div className="flex flex-1 flex-col px-6 pb-6">{children}</div>
    </section>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", size = "md", type = "button" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "gold";
  size?: "md" | "lg";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "btn-primary text-white disabled:bg-none disabled:bg-slate-300 disabled:shadow-none",
    gold: "bg-gradient-to-r from-gold-400 to-gold-500 text-navy-900 shadow-lg shadow-gold-500/30 hover:-translate-y-px hover:shadow-gold-500/50 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none",
    secondary: "border border-brand-200 bg-white text-navy-800 hover:border-brand-400 hover:bg-brand-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-navy-900/5 hover:text-navy-900 disabled:text-slate-300",
  }[variant];
  const sizes = { md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-[15px]" }[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 disabled:cursor-not-allowed ${sizes} ${styles}`}
    >
      {children}
    </button>
  );
}

const BADGE = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-500/30",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15",
  blue: "bg-brand-50 text-brand-700 ring-brand-500/20",
  gold: "bg-gold-300/30 text-gold-600 ring-gold-500/30",
};

export function Badge({ tone, icon, children }: { tone: keyof typeof BADGE; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

export function Alert({ tone, children }: { tone: "red" | "amber" | "blue" | "green"; children: ReactNode }) {
  const map = {
    red: { cls: "border-rose-200 bg-rose-50/90 text-rose-800", icon: <IconXCircle size={18} className="text-rose-500" /> },
    amber: { cls: "border-amber-200 bg-amber-50/90 text-amber-900", icon: <IconAlert size={18} className="text-amber-500" /> },
    blue: { cls: "border-brand-200 bg-brand-50/90 text-navy-800", icon: <IconInfo size={18} className="text-brand-500" /> },
    green: { cls: "border-emerald-200 bg-emerald-50/90 text-emerald-800", icon: <IconCheckCircle size={18} className="text-emerald-500" /> },
  }[tone];
  return (
    <div className={`anim-rise flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${map.cls}`}>
      <span className="mt-px shrink-0">{map.icon}</span>
      <div>{children}</div>
    </div>
  );
}

/** Coloured circle with initials, used for candidate names. */
const AVATAR_COLORS = [
  "from-brand-500 to-cyan-brand",
  "from-navy-700 to-brand-500",
  "from-gold-500 to-gold-300",
  "from-cyan-brand to-sky-brand",
  "from-brand-600 to-navy-800",
];

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ${color}`}
    >
      {initials}
    </span>
  );
}

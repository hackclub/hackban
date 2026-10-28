"use client";

import DOMPurify from "dompurify";
import { AnimatePresence, motion } from "framer-motion";
import { marked } from "marked";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// ---------- Colors ----------

const LABEL_BASE: Record<string, [subtle: string, mid: string, bold: string]> = {
  green: ["#baf3db", "#4bce97", "#1f845a"],
  yellow: ["#f8e6a0", "#f5cd47", "#946f00"],
  orange: ["#fedec8", "#fea362", "#c25100"],
  red: ["#ffd5d2", "#f87168", "#c9372c"],
  purple: ["#dfd8fd", "#9f8fef", "#6e5dc6"],
  blue: ["#cce0ff", "#579dff", "#0c66e4"],
  sky: ["#c6edfb", "#6cc3e0", "#227d9b"],
  lime: ["#d3f1a7", "#94c748", "#5b7f24"],
  pink: ["#fdd0ec", "#e774bb", "#ae4787"],
  black: ["#dcdfe4", "#8590a2", "#626f86"],
};

// Dark-theme equivalents (Trello dark): subtle = deep tint, mid = saturated, bold = bright
const LABEL_DARK: Record<string, [subtle: string, mid: string, bold: string]> = {
  green: ["#164b35", "#216e4e", "#4bce97"],
  yellow: ["#533f04", "#7f5f01", "#e2b203"],
  orange: ["#702e00", "#a54800", "#fea362"],
  red: ["#5d1f1a", "#ae2e24", "#f87168"],
  purple: ["#352c63", "#5e4db2", "#9f8fef"],
  blue: ["#09326c", "#0055cc", "#579dff"],
  sky: ["#164555", "#206a83", "#6cc3e0"],
  lime: ["#37471f", "#4c6b1f", "#94c748"],
  pink: ["#50253f", "#943d73", "#e774bb"],
  black: ["#454f59", "#596773", "#8c9bab"],
};

export const LABEL_COLORS = Object.keys(LABEL_BASE).flatMap((c) => [`${c}_light`, c, `${c}_dark`]);

// light-dark() follows the color-scheme set per theme in globals.css
const ld = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

export function labelStyle(color: string | null | undefined) {
  if (!color) return { background: "var(--color-neutral)", color: "var(--color-text)", border: "1px solid var(--color-border)" };
  const [base, variant] = color.split("_") as [string, string | undefined];
  const l = LABEL_BASE[base] ?? LABEL_BASE.black!;
  const d = LABEL_DARK[base] ?? LABEL_DARK.black!;
  if (variant === "light") return { background: ld(l[0], d[0]), color: ld("#172b4d", "#dee4ea") };
  if (variant === "dark") return { background: ld(l[2], d[2]), color: ld("#fff", "#1d2125") };
  return { background: ld(l[1], d[1]), color: ld("#172b4d", "#fff") };
}

export function coverColor(color: string) {
  // Never pass the stored string through: it lands in a CSS `background` (e.g. url(...) would load for every viewer).
  return LABEL_BASE[color]?.[1] ?? "var(--color-neutral-bold)";
}

export const BOARD_COLORS = [
  "#0079bf",
  "#d29034",
  "#519839",
  "#b04632",
  "#89609e",
  "#cd5a91",
  "#4bbf6b",
  "#00aecc",
  "#838c91",
];
export const BOARD_GRADIENTS = [
  "linear-gradient(135deg, #0c66e4 0%, #37b4c3 100%)",
  "linear-gradient(135deg, #09326c 0%, #0c66e4 100%)",
  "linear-gradient(135deg, #5e4db2 0%, #e774bb 100%)",
  "linear-gradient(135deg, #e34935 0%, #faa53d 100%)",
  "linear-gradient(135deg, #1f845a 0%, #7ee2b8 100%)",
  "linear-gradient(135deg, #172b4d 0%, #44546f 100%)",
];

export function boardBg(b: { background: string; bgImage?: string | null }) {
  if (b.bgImage) return { backgroundImage: `url("${b.bgImage}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundColor: b.background };
  return { background: b.background };
}

// ---------- Avatar ----------

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Sub-line for a placeholder member who hasn't logged in yet. */
export const ghostNote = (u: { invitedEmail?: string | null }) => (u.invitedEmail ? "Invited, hasn't logged in yet" : "Imported from Trello");

export function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function Avatar({
  user,
  size = 32,
  className = "",
}: {
  user: { name?: string | null; image?: string | null; isGhost?: boolean };
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      title={user.name ?? undefined}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-neutral-bold)] font-semibold text-[var(--color-text)] select-none ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {user.image && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials(user.name)
      )}
    </span>
  );
}

/** Workspace logo: uploaded image, or the colored initial Trello falls back to. */
export function WorkspaceLogo({ ws, size = 32, className = "" }: { ws: { name: string; logo?: string | null }; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const hues = ["from-[#4bce97] to-[#1f845a]", "from-[#f87168] to-[#c9372c]", "from-[#579dff] to-[#0c66e4]", "from-[#9f8fef] to-[#6e5dc6]", "from-[#fea362] to-[#c25100]", "from-[#e774bb] to-[#ae4787]"];
  // Stable color per workspace name.
  const hue = hues[[...ws.name].reduce((n, c) => n + c.charCodeAt(0), 0) % hues.length];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-gradient-to-b font-bold text-white select-none ${hue} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {ws.logo && !broken ? (
        // Transparent logos sit on a theme-aware neutral (not white, which hid
        // white artwork) and are contained, not cropped.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ws.logo}
          alt=""
          className="h-full w-full bg-[var(--color-neutral-bold)] object-contain p-[8%]"
          onError={() => setBroken(true)}
        />
      ) : (
        ws.name[0]?.toUpperCase()
      )}
    </span>
  );
}

// ---------- Buttons ----------

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "subtle" | "danger";
};

export function Button({ variant = "default", className = "", ...props }: BtnProps) {
  const v = {
    default: "bg-[var(--color-neutral)] hover:bg-[var(--color-neutral-hover)] active:bg-[var(--color-neutral-pressed)] text-[var(--color-text)]",
    primary: "bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-[var(--color-on-brand)]",
    subtle: "bg-transparent hover:bg-[var(--color-neutral-hover)] text-[var(--color-text-subtle)]",
    danger: "bg-[#c9372c] hover:bg-[#ae2e24] text-white",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-[3px] px-3 text-sm font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    />
  );
}

export function IconButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[3px] transition-colors hover:bg-[var(--color-neutral-hover)] ${className}`}
    />
  );
}

// ---------- Popover ----------
// Trello popovers are anchored to the trigger, 304px wide, with a centred
// title, a close X and an optional back arrow for nested panes.

type Anchor = { el: HTMLElement } | { x: number; y: number };

const PopoverCtx = createContext<{ close: () => void } | null>(null);
export const usePopover = () => useContext(PopoverCtx)!;

export function Popover({
  anchor,
  open,
  onClose,
  title,
  onBack,
  width = 304,
  maxHeight,
  children,
}: {
  anchor: Anchor | null;
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  onBack?: () => void;
  width?: number;
  maxHeight?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = "el" in anchor ? anchor.el.getBoundingClientRect() : { left: anchor.x, bottom: anchor.y, top: anchor.y };
      const h = ref.current?.offsetHeight ?? 300;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPos({ top, left });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor && "el" in anchor && anchor.el.contains(t)) return;
      // clicks inside another (nested) popover shouldn't close this one
      if ((t as HTMLElement).closest?.("[data-popover]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);

  const ctx = useMemo(() => ({ close: onClose }), [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          data-popover
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxHeight: maxHeight && `min(${maxHeight}px, calc(100vh - 16px))` }}
          className="fixed z-[100] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-overlay)]"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {title !== undefined && (
            <div className="relative grid h-10 grid-cols-[32px_1fr_32px] items-center px-2">
              {onBack ? (
                <IconButton className="h-8 w-8" onClick={onBack} aria-label="Back">
                  <Icon name="back" />
                </IconButton>
              ) : (
                <span />
              )}
              <h2 className="truncate text-center text-sm font-semibold text-[var(--color-text-subtle)]">{title}</h2>
              <IconButton className="h-8 w-8" onClick={onClose} aria-label="Close">
                <Icon name="close" />
              </IconButton>
            </div>
          )}
          <PopoverCtx.Provider value={ctx}>
            <div className="px-3 pb-3">{children}</div>
          </PopoverCtx.Provider>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Convenience hook: `const p = usePopoverState(); <button ref={p.ref} onClick={p.toggle}/>` */
export function usePopoverState<T extends HTMLElement = HTMLButtonElement>() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const elRef = useRef<T | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const openAt = useCallback((a: Anchor) => setAnchor(a), []);
  const toggle = useCallback(
    (e?: React.MouseEvent) => {
      const el = (e?.currentTarget as HTMLElement | undefined) ?? elRef.current;
      setAnchor((cur) => (cur ? null : el ? { el } : null));
    },
    [],
  );
  return { anchor, open: !!anchor, close, toggle, openAt, ref: elRef };
}

export function MenuItem({ children, onClick, danger, disabled }: { children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`-mx-3 block w-[calc(100%+24px)] px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-neutral)] disabled:opacity-50 ${danger ? "text-[var(--color-danger)]" : ""}`}
    >
      {children}
    </button>
  );
}

export function MenuSep() {
  return <hr className="my-2 border-[var(--color-border)]" />;
}

// ---------- Inputs ----------

export const inputCls =
  "w-full rounded-[3px] border-0 bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] shadow-[inset_0_0_0_1px_var(--color-border)] outline-none transition-shadow focus:shadow-[inset_0_0_0_2px_var(--color-focus)]";

export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 1, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} style={{ resize: "none", overflow: "hidden", ...rest.style }} />;
}

// ---------- Markdown ----------

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => {
    if (typeof window === "undefined") return "";
    const raw = marked.parse(text, { async: false });
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
  }, [text]);
  return (
    <div
      className={`markdown break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a) {
          e.preventDefault();
          e.stopPropagation();
          window.open(a.href, "_blank", "noopener");
        }
      }}
    />
  );
}

// ---------- Icons (inline, Trello-ish 16px glyphs) ----------

const PATHS: Record<string, string> = {
  close: "M6.3 5 12 10.6 17.7 5l1.3 1.3-5.7 5.7 5.7 5.7-1.3 1.3-5.7-5.7L6.3 19 5 17.7l5.6-5.7L5 6.3z",
  back: "M10.3 6.3 4.6 12l5.7 5.7 1.4-1.4L8.4 13H19v-2H8.4l3.3-3.3z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z",
  more: "M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4m6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4m6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
  starOutline: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9zm0 4.5-1.3 2.7-3 .4 2.2 2.1-.5 3L12 14.8l2.7 1.4-.5-3 2.2-2.1-3-.4z",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  edit: "M15.6 3.3a2 2 0 0 1 2.8 0l2.3 2.3a2 2 0 0 1 0 2.8L9 20H4v-5zM14 7.7 6 15.6V18h2.4l8-8z",
  desc: "M4 5h16v2H4zm0 4h16v2H4zm0 4h16v2H4zm0 4h10v2H4z",
  comment: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6l-5 4v-4H6a2 2 0 0 1-2-2zm2 0v10h3v2l2.5-2H18V5z",
  attach: "M16.5 6v11.5a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6H9v9.5a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v12.5a6 6 0 0 0 12 0V6z",
  check: "M5 5h14v14H5zm2 2v10h10V7zm8.3 2.3 1.4 1.4-5.7 5.7-3.4-3.4 1.4-1.4 2 2z",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14m1 2v5l3.5 2-1 1.7L11 13V7z",
  label: "M11.6 3H20a1 1 0 0 1 1 1v8.4l-9 9L2.6 12zM16 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
  user: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 10c4 0 8 2 8 5v3H4v-3c0-3 4-5 8-5",
  card: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 2v12h14V6zm2 2h10v2H7z",
  list: "M3 5h4v14H3zm7 0h4v9h-4zm7 0h4v11h-4z",
  archive: "M3 4h18v5H3zm1 6h16v10H4zm5 2v2h6v-2z",
  move: "M12 2l4 4h-3v5h5V8l4 4-4 4v-3h-5v5h3l-4 4-4-4h3v-5H6v3l-4-4 4-4v3h5V6H8z",
  copy: "M8 3h11a2 2 0 0 1 2 2v11h-2V5H8zM5 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2m0 2v10h10V9z",
  eye: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7m0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4",
  cover: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 2v6h14V6z",
  activity: "M3 5h18v2H3zm0 6h12v2H3zm0 6h18v2H3z",
  megaphone: "M18 4v16l-6-4H8l1 5H7l-1.2-5H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h7zm-2 3.7L12.6 10H5v4h7.6l3.4 2.3zM20 9h2v6h-2z",
  bell: "M12 3a6 6 0 0 1 6 6v4l2 3v1H4v-1l2-3V9a6 6 0 0 1 6-6m-2 16h4a2 2 0 0 1-4 0",
  search: "M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3m0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
  filter: "M3 5h18v2l-7 7v6l-4-2v-4L3 7z",
  share: "M18 3a3 3 0 1 1-2.8 4.1L8.9 10.4a3 3 0 0 1 0 3.2l6.3 3.3A3 3 0 1 1 15 18l-6.6-3.4a3 3 0 1 1 0-5.2L15 6a3 3 0 0 1 3-3",
  trash: "M9 3h6l1 2h4v2H4V5h4zM5 8h14l-1 13H6z",
  globe: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m-1 2.1A7 7 0 0 0 5.1 11H8a14 14 0 0 1 3-5.9m2 0a14 14 0 0 1 3 5.9h2.9A7 7 0 0 0 13 5.1M10 11h4a12 12 0 0 0-2-4.5A12 12 0 0 0 10 11m-4.9 2a7 7 0 0 0 5.9 5.9A14 14 0 0 1 8 13zm4.9 0a12 12 0 0 0 2 4.5 12 12 0 0 0 2-4.5zm6 0a14 14 0 0 1-3 5.9 7 7 0 0 0 5.9-5.9z",
  lock: "M12 2a5 5 0 0 1 5 5v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1V7a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3",
  people: "M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8m8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6M9 14c4 0 7 2 7 4.5V21H2v-2.5C2 16 5 14 9 14m8 0c3 0 5 1.6 5 3.5V21h-4v-2.5c0-1.7-.7-3.2-2-4.4z",
  download: "M11 3h2v10l3.3-3.3 1.4 1.4L12 16.8l-5.7-5.7 1.4-1.4L11 13zM4 19h16v2H4z",
  grid: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  home: "M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z",
  settings: "M10.3 2h3.4l.5 2.6 1.6.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.6 2.6.5v3.4l-2.6.5-.7 1.6 1.5 2.2-2.4 2.4-2.2-1.5-1.6.7-.5 2.6h-3.4l-.5-2.6-1.6-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.6L2 13.7v-3.4l2.6-.5.7-1.6-1.5-2.2 2.4-2.4 2.2 1.5 1.6-.7zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7",
  board: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1m1 2v14h4V5zm6 0v9h4V5zm6 0v6h2V5z",
  history: "M12 3a9 9 0 1 1-8.5 12h2.1A7 7 0 1 0 6 8.3L8.5 11H3V5.5l1.6 1.6A9 9 0 0 1 12 3m-1 4h2v4.6l3.2 1.9-1 1.7L11 12.7z",
  profile: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20m0 2a8 8 0 0 0-6.2 13A9 9 0 0 1 12 15a9 9 0 0 1 6.2 2A8 8 0 0 0 12 4m0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7",
  chevronLeft: "M15.4 5.4 9.8 11l-.6.6.6.6 5.6 5.6-1.4 1.4L7 12l7-7z",
  chevronDown: "M7 9l5 5 5-5z",
  repeat: "M17 2l4 4-4 4V7H7a2 2 0 0 0-2 2v3H3V9a4 4 0 0 1 4-4h10zM7 22l-4-4 4-4v3h10a2 2 0 0 0 2-2v-3h2v3a4 4 0 0 1-4 4H7z",
  collapseIn: "M2 11h7.2L6.6 8.4 8 7l5 5-5 5-1.4-1.4 2.6-2.6H2zm20 2h-7.2l2.6 2.6L16 17l-5-5 5-5 1.4 1.4-2.6 2.6H22z",
  collapse: "M8 5h2v14H8zm6 0h2v14h-2z",
  sort: "M7 3l4 4H8v11H6V7H3zm10 18-4-4h3V6h2v11h3z",
  blocked: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m-5.2 4.2A7 7 0 0 0 16.8 17.2zm1.4-1.4 9.8 9.8A7 7 0 0 0 8.2 5.8",
};

export function Icon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={`shrink-0 ${className}`} aria-hidden>
      <path d={PATHS[name] ?? ""} fillRule="evenodd" />
    </svg>
  );
}

// ---------- Due date helpers ----------

export function dueState(due: Date | null, complete: boolean) {
  if (!due) return null;
  if (complete) return "complete" as const;
  const ms = due.getTime() - Date.now();
  if (ms < -24 * 3600 * 1000) return "late" as const;
  if (ms < 0) return "overdue" as const;
  if (ms < 24 * 3600 * 1000) return "soon" as const;
  return "later" as const;
}

export const dueStyles = {
  complete: "bg-[var(--t-due-complete-bg)] text-[var(--t-due-complete-fg)]",
  overdue: "bg-[var(--t-due-overdue-bg)] text-[var(--t-due-overdue-fg)]",
  late: "bg-[var(--t-due-late-bg)] text-[var(--t-due-late-fg)] shadow-[var(--t-due-late-glow)]",
  soon: "bg-[var(--t-due-soon-bg)] text-[var(--t-due-soon-fg)]",
  later: "",
} as const;

export function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#ec3750" />
      <rect x="6" y="6" width="8.5" height="18" rx="2" fill="#fff" />
      <rect x="17.5" y="6" width="8.5" height="11" rx="2" fill="#fff" />
    </svg>
  );
}

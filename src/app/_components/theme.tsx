"use client";

import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "hackban:theme";

/**
 * Runs before paint (inlined in <head>) so the page never flashes the wrong
 * theme. Keep it dependency-free; it is stringified.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){document.documentElement.dataset.theme=(p==="system"?(m.matches?"dark":"light"):p)};a();m.addEventListener("change",function(){if((localStorage.getItem("${KEY}")||"system")==="system")a()})}catch(e){}})()`;

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    try {
      setPref((localStorage.getItem(KEY) as ThemePref | null) ?? "system");
    } catch {}
  }, []);
  const set = (p: ThemePref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {}
    apply(p);
  };
  return [pref, set] as const;
}

export function ThemePicker() {
  const [pref, set] = useTheme();
  return (
    <div className="flex gap-1 rounded-[3px] bg-[var(--color-neutral)] p-0.5">
      {(["light", "dark", "system"] as const).map((p) => (
        <button
          key={p}
          onClick={() => set(p)}
          className={`h-7 flex-1 rounded-[3px] text-xs font-medium capitalize transition-colors ${
            pref === p ? "bg-[var(--color-surface)] shadow-[var(--shadow-card)]" : "hover:bg-[var(--color-neutral-hover)]"
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

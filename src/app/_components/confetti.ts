/**
 * A small, dependency-free confetti burst from a point (or an element's
 * center). Uses the Web Animations API on short-lived DOM nodes; does nothing
 * when the user prefers reduced motion.
 */
const COLORS = ["#4bce97", "#f5cd47", "#579dff", "#f87168", "#9f8fef", "#fea362", "#e774bb"];

export function confetti(from: HTMLElement | { x: number; y: number }, count = 22) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let x: number;
  let y: number;
  if ("getBoundingClientRect" in from) {
    const r = from.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  } else {
    ({ x, y } = from);
  }
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    const size = 4 + Math.random() * 4;
    const round = Math.random() < 0.35;
    Object.assign(el.style, {
      position: "fixed",
      left: `${x}px`,
      top: `${y}px`,
      width: `${size}px`,
      height: `${round ? size : size * 0.45}px`,
      background: COLORS[i % COLORS.length]!,
      borderRadius: round ? "50%" : "1px",
      pointerEvents: "none",
      zIndex: "1000",
    });
    document.body.appendChild(el);
    // Fan out mostly upwards, then fall with a bit of spin.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const dist = 28 + Math.random() * 46;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = (Math.random() - 0.5) * 720;
    const anim = el.animate(
      [
        { transform: "translate(-50%, -50%) rotate(0deg) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 42}px)) rotate(${spin}deg) scale(0.8)`, opacity: 0 },
      ],
      { duration: 650 + Math.random() * 350, easing: "cubic-bezier(.2,.8,.3,1)" },
    );
    anim.onfinish = () => el.remove();
  }
}

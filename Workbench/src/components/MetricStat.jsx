import { useEffect, useRef } from "react";
import gsap from "gsap";
import { formatNumber } from "../lib/format";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const completedMetricAnimations = new Set();

export function MetricStat({ label, value, hint, accent = false, suffix = "", onClick }) {
  const numberRef = useRef(null);
  const animationKey = `${label}:${suffix}`;
  const empty = value === null || value === undefined || value === "";
  const isNumeric = !empty && !Number.isNaN(Number(value));
  const showFinalValue = completedMetricAnimations.has(animationKey) || prefersReducedMotion();

  useEffect(() => {
    const node = numberRef.current;
    if (!node || !isNumeric) return undefined;
    if (prefersReducedMotion() || completedMetricAnimations.has(animationKey)) {
      node.textContent = `${formatNumber(value)}${suffix}`;
      return undefined;
    }
    const counter = { n: 0 };
    const tween = gsap.to(counter, { n: Number(value), duration: 1.2, ease: "power3.out", onUpdate: () => { node.textContent = `${formatNumber(Math.round(counter.n))}${suffix}`; }, onComplete: () => { completedMetricAnimations.add(animationKey); node.textContent = `${formatNumber(value)}${suffix}`; } });
    return () => tween.kill();
  }, [animationKey, value, suffix, isNumeric]);

  return <div className={`metric${accent ? " metric--accent" : ""}`} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); } } : undefined} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
    <span className="metric__label">{label}</span>
    <div className="metric__value" ref={numberRef}>{empty ? "—" : !isNumeric ? `${value}${suffix}` : showFinalValue ? `${formatNumber(value)}${suffix}` : `0${suffix}`}</div>
    {hint ? <div className="metric__hint">{hint}</div> : null}
  </div>;
}

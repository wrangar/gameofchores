"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RewardEvent } from "../../lib/rewards";
import { rewards } from "../../lib/rewards";

type OverlayItem =
  | { id: string; kind: "coin"; amountRs: number }
  | { id: string; kind: "confetti" }
  | { id: string; kind: "badge"; badgeKey: string }
  | { id: string; kind: "streak"; streak: number }
  | { id: string; kind: "toast"; message: string };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function ttlFor(kind: OverlayItem["kind"]) {
  switch (kind) {
    case "coin":
      return 900;
    case "confetti":
      return 700;
    case "badge":
      return 1600;
    case "streak":
      return 1200;
    case "toast":
      return 1800;
  }
}

/**
 * Global overlay for kid-friendly reward feedback.
 * (Deliberately implemented without external JSON assets so it always builds.)
 */
export default function RewardsLayer() {
  const [items, setItems] = useState<OverlayItem[]>([]);

  const push = (item: OverlayItem) => {
    setItems((prev) => [...prev, item]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    }, ttlFor(item.kind));
  };

  useEffect(() => {
    const off = rewards.on((evt: RewardEvent) => {
      const id = uid();
      if (evt.type === "coin_burst") push({ id, kind: "coin", amountRs: evt.amountRs });
      if (evt.type === "confetti_small") push({ id, kind: "confetti" });
      if (evt.type === "badge_unlock") push({ id, kind: "badge", badgeKey: evt.badgeKey });
      if (evt.type === "streak_fireworks") push({ id, kind: "streak", streak: evt.streak });
      if (evt.type === "toast") push({ id, kind: "toast", message: evt.message });
    });
    return () => {
    off();
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      <AnimatePresence>
        {items.map((it) => {
          if (it.kind === "coin") {
            return (
              <motion.div
                key={it.id}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="rounded-3xl bg-white/90 px-6 py-5 shadow-2xl"
                  initial={{ scale: 0.7, y: 16, opacity: 0 }}
                  animate={{ scale: 1, y: 0, opacity: 1 }}
                  exit={{ scale: 0.9, y: -10, opacity: 0 }}
                >
                  <div className="text-5xl font-extrabold text-purple-700">+Rs.{it.amountRs}</div>
                  <div className="mt-2 flex items-center justify-center gap-2 text-2xl">
                    <span>🪙</span>
                    <span>✨</span>
                    <span>🪙</span>
                  </div>
                </motion.div>
              </motion.div>
            );
          }

          if (it.kind === "confetti") {
            return (
              <motion.div
                key={it.id}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="text-5xl"
                  initial={{ scale: 0.6, rotate: -8 }}
                  animate={{ scale: 1.0, rotate: 8 }}
                  exit={{ opacity: 0 }}
                >
                  🎉
                </motion.div>
              </motion.div>
            );
          }

          if (it.kind === "badge") {
            return (
              <motion.div
                key={it.id}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                <div className="rounded-3xl bg-white/95 px-7 py-6 shadow-2xl">
                  <div className="text-2xl font-extrabold text-purple-700">Badge Unlocked!</div>
                  <div className="mt-2 text-lg text-gray-700">{it.badgeKey}</div>
                  <div className="mt-3 text-4xl">🏅✨</div>
                </div>
              </motion.div>
            );
          }

          if (it.kind === "streak") {
            return (
              <motion.div
                key={it.id}
                className="absolute left-1/2 top-14 -translate-x-1/2"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="rounded-3xl bg-purple-700/90 text-white px-6 py-4 shadow-2xl">
                  <div className="text-xl font-extrabold">🔥 Streak +1</div>
                  <div className="text-white/90">Now: {it.streak} days</div>
                </div>
              </motion.div>
            );
          }

          return (
            <motion.div
              key={it.id}
              className="absolute left-1/2 bottom-10 -translate-x-1/2"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
            >
              <div className="rounded-2xl bg-black/80 text-white px-4 py-3 shadow-xl">{it.message}</div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

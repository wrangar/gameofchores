"use client";

import { useEffect } from "react";
import { rewards, type RewardsMode } from "./index";

/**
 * Initializes rewards (mode) and unlocks audio after the first user gesture.
 */
export function useRewards(mode: RewardsMode) {
  useEffect(() => {
    rewards.init(mode);

    const handler = () => rewards.unlockAudioFromGesture();
    window.addEventListener("pointerdown", handler, { once: true });

    return () => {
      window.removeEventListener("pointerdown", handler);
    };
  }, [mode]);

  return rewards;
}

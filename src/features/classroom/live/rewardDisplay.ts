export const REWARD_STARS_PER_MOON = 10;
export const REWARD_MOONS_PER_SUN = 10;
export const REWARD_STARS_PER_SUN = REWARD_STARS_PER_MOON * REWARD_MOONS_PER_SUN;

export interface ClassroomRewardSymbols {
  total: number;
  suns: number;
  moons: number;
  stars: number;
}

/** Base-ten visual denominations: 10 stars become one moon; 10 moons become one sun. */
export function decomposeClassroomReward(count: number): ClassroomRewardSymbols {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const suns = Math.floor(total / REWARD_STARS_PER_SUN);
  const afterSuns = total % REWARD_STARS_PER_SUN;
  const moons = Math.floor(afterSuns / REWARD_STARS_PER_MOON);

  return {
    total,
    suns,
    moons,
    stars: afterSuns % REWARD_STARS_PER_MOON,
  };
}

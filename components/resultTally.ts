export const RESULT_TALLY_MS = 1800;
export const RESULT_LAND_MS = 320;

export interface ResultRecord {
  failed: boolean;
  leadMember: number;
  score: number;
  sticks: number;
  pigs: number;
  progress: number;
}

export const resultTitle = (failed: boolean) => failed ? '再试一次 终将抵达' : '飞越成功！';

/** One clock for every value: no sequential delays, including zero-score runs. */
export function resultTallyAt(record: ResultRecord, elapsed: number) {
  const progress = Math.min(1, Math.max(0, elapsed / RESULT_TALLY_MS));
  const ease = 1 - (1 - progress) ** 3;
  return {
    score: Math.round(Math.max(0, record.score) * ease),
    sticks: Math.round(Math.max(0, record.sticks) * ease),
    pigs: Math.round(Math.max(0, record.pigs) * ease),
    percent: Math.round(Math.min(1, Math.max(0, record.progress)) * 100 * ease),
    progress,
    landed: progress === 1,
  };
}

export type ResultTally = ReturnType<typeof resultTallyAt>;

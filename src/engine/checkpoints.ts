// Band checkpoint schedule: the rounds at which percentile bands record the bankroll. Pure; it only
// decides what the band observer RECORDS and never touches a simulation.

/** Every round from 0 to this is a checkpoint: progressions bust early, so early rounds are exact. */
export const DENSE_ROUNDS = 64;
/** After the dense part, each step adds 1/GROWTH_DIV of the rounds so far (+25%): even on a log-time axis. */
const GROWTH_DIV = 4;
/** Spacing never exceeds ceil(maxRounds / CAP_DIV): the even spacing of the old 200-checkpoint schedule. */
const CAP_DIV = 200;

/**
 * Checkpoint rounds for a session of at most `maxRounds` rounds: 0, 1, ..., min(maxRounds, 64), then
 * steps of min(ceil(maxRounds / 200), max(1, floor(x / 4))), the last clipped to end EXACTLY at
 * maxRounds. Strictly increasing integers. At most 287 entries for any maxRounds up to 1,000,000, and no
 * gap wider than ceil(maxRounds / 200), so never coarser than the old evenly spaced schedule anywhere.
 */
export function checkpointRounds(maxRounds: number): Float64Array {
  const cap = Math.max(1, Math.ceil(maxRounds / CAP_DIV));
  const out: number[] = [];
  const dense = Math.min(maxRounds, DENSE_ROUNDS);
  for (let r = 0; r <= dense; r++) out.push(r);
  let x = dense;
  while (x < maxRounds) {
    x = Math.min(maxRounds, x + Math.min(cap, Math.max(1, Math.floor(x / GROWTH_DIV))));
    out.push(x);
  }
  return Float64Array.from(out);
}

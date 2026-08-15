export type TimedItem = {
  start: number;
  end: number;
};

export const FOLLOW_RESUME_DELAY_MS = 3000;

export function findActiveTimedItem<T extends TimedItem>(items: T[], currentTime: number): T | undefined {
  return items.find((item) => currentTime >= item.start && currentTime < item.end);
}

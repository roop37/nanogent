import { afterEach, expect, it, vi } from "vitest";
import { visiblePolling } from "../lib/polling";

class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
afterEach(() => vi.useRealTimers());
it("changes cadence, aborts hidden requests and resumes without duplicate timers", async () => {
  vi.useFakeTimers();
  const visibility = new Visibility();
  let delay = 5000;
  const signals: AbortSignal[] = [];
  const work = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    return delay;
  });
  const stop = visiblePolling(work, () => 30000, visibility);
  await vi.advanceTimersByTimeAsync(4999);
  expect(work).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(work).toHaveBeenCalledTimes(2);
  visibility.change(true);
  expect(signals.at(-1)?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(work).toHaveBeenCalledTimes(2);
  delay = 30000;
  visibility.change(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(work).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(29999);
  expect(work).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(work).toHaveBeenCalledTimes(4);
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(work).toHaveBeenCalledTimes(4);
});
it("discards an aborted response that arrives after visibility resumes", async () => {
  vi.useFakeTimers();
  const visibility = new Visibility();
  let resolve: (delay: number) => void = () => {};
  const work = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(5000);
  const stop = visiblePolling(work, () => 3000, visibility);
  visibility.change(true);
  visibility.change(false);
  resolve(5000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(work).toHaveBeenCalledTimes(3);
  stop();
});
it("retries failures and permanently stops after a terminal result", async () => {
  vi.useFakeTimers();
  const visibility = new Visibility();
  const work = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
  const failure = vi.fn(() => 3000);
  const stop = visiblePolling(work, failure, visibility);
  await vi.advanceTimersByTimeAsync(3000);
  expect(failure).toHaveBeenCalledTimes(1);
  expect(work).toHaveBeenCalledTimes(2);
  visibility.change(true);
  visibility.change(false);
  await vi.advanceTimersByTimeAsync(30000);
  expect(work).toHaveBeenCalledTimes(2);
  stop();
});

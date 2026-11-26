type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
export function visiblePolling(
  work: (signal: AbortSignal) => Promise<number | null>,
  onError: (error: unknown) => number,
  visibility: Visibility = document,
) {
  let disposed = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  async function poll() {
    if (disposed || finished || visibility.hidden) return;
    const controller = new AbortController();
    request = controller;
    let delay: number | null;
    try {
      delay = await work(controller.signal);
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      delay = onError(error);
    }
    if (disposed || controller.signal.aborted) return;
    if (delay === null) {
      finished = true;
      return;
    }
    if (!visibility.hidden) timer = setTimeout(poll, delay);
  }
  function changed() {
    clearTimeout(timer);
    request?.abort();
    if (!visibility.hidden) void poll();
  }
  visibility.addEventListener("visibilitychange", changed);
  void poll();
  return () => {
    disposed = true;
    clearTimeout(timer);
    request?.abort();
    visibility.removeEventListener("visibilitychange", changed);
  };
}

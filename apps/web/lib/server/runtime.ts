import "server-only";
import { type Backend, createApi } from "./api";
import { getSession } from "./auth";
import { settings, testMode } from "./settings";
export async function withBackend<T>(work: (backend: Backend) => Promise<T>): Promise<T> {
  if (testMode()) {
    const { fakeBackend } = await import("./test-backend");
    return work(fakeBackend());
  }
  const { withProductionBackend } = await import("./backend");
  return withProductionBackend(work);
}
export const api = createApi({ session: getSession, settings, withBackend });

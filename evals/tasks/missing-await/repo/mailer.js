export function createMailer(transport) {
  return {
    async send(to, subject) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      transport.push({ to, subject });
      return { ok: true };
    },
  };
}

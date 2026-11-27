export const verifiedRunPath = "/runs/run_000000demo_000000000000000000000004";
export const longDiff = `diff --git a/src/entries.ts b/src/entries.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/entries.ts\n@@ -0,0 +1,2105 @@\n${Array.from({ length: 2105 }, (_, i) => `+export const entry${i + 1} = ${i + 1};`).join("\n")}\n`;

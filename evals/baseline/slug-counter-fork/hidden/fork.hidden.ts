import { type CountableSlugify, slugifyWithCounter } from "./index.js";

const fork: CountableSlugify = slugifyWithCounter().fork();
fork.reset();
fork.fork()("sample", { separator: "_" });

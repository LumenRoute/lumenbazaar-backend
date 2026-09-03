import { serviceName } from "@lumenbazaar/shared";

import { createWorkerApp } from "./worker.js";

const worker = createWorkerApp();

await worker.start();

console.log(`${serviceName} worker ready`);

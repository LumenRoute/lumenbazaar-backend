import { buildApiApp } from "./app.js";
import { loadConfig } from "@lumenbazaar/shared";

const config = loadConfig();

const app = buildApiApp({ config });

await app.listen({ host: config.api.host, port: config.api.port });

import { buildApiApp } from "./app.js";

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.API_PORT ?? "3000", 10);

const app = buildApiApp();

await app.listen({ host, port });

import app from "./app";
import { scheduled } from "./scheduled";

// Re-export do Durable Object pra o Wrangler enxergar a classe pelo entry.
export { RateLimiter } from "./durable-objects/rate-limiter";

// Worker entry: fetch (HTTP) + scheduled (Cron Triggers).
export default {
	fetch: app.fetch,
	scheduled,
};

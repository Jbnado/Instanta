import app from "./app";
import { withSentry } from "./lib/sentry";
import { scheduled } from "./scheduled";

// Re-export do Durable Object pra o Wrangler enxergar a classe pelo entry.
export { RateLimiter } from "./durable-objects/rate-limiter";

// Worker entry: fetch (HTTP) + scheduled (Cron Triggers).
// `withSentry` envelopa o entry. Inicialização ocorre apenas em prod com DSN;
// fora disso, passa direto sem overhead.
export default withSentry({
	fetch: app.fetch,
	scheduled,
});

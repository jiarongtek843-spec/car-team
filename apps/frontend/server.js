// Production server for the frontend service. Replaces the plain static file
// server (`serve`) that this project used before.
//
// Why this exists (Critical Bug — Safari "Not authenticated"):
// Frontend and Backend are two separate services on two different
// *.up.railway.app subdomains. `up.railway.app` is registered on the public
// suffix list, so browsers treat each subdomain as its own *site* — a cookie
// set by the backend is, from the browser's point of view, a third-party
// cookie on the frontend's page. Safari's Intelligent Tracking Prevention
// blocks third-party cookies by default, no matter how SameSite/Secure are
// configured on the cookie itself — SameSite=None;Secure only controls
// whether a cross-site cookie is *sent*, it does not override ITP's
// third-party-cookie block. Chromium-based browsers were (at the time this
// was built) more permissive here, which is why this looked fine in testing
// but broke for real users on iPhone Safari.
//
// The fix is to make the browser see only one origin. This server serves the
// built SPA *and* transparently proxies every `/api/*` request to the
// backend, so from the browser's perspective the cookie is always
// first-party (same origin as the page). No SameSite/ITP concerns left,
// because there is no cross-site request happening in the browser at all —
// the proxying happens server-to-server, which the browser never sees.
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 3000);

// BACKEND_INTERNAL_URL: the actual backend to proxy to. Prefer Railway's
// private network (service-to-service traffic never leaves Railway's
// network, no extra public-internet hop) when available; fall back to the
// backend's public URL otherwise, which works identically from the proxy's
// point of view — it's just an extra hop.
const backendTarget =
  process.env.BACKEND_INTERNAL_URL ?? process.env.VITE_API_BASE_URL ?? "http://localhost:4000";

app.use(
  "/api",
  createProxyMiddleware({
    // Express strips the "/api" mount prefix before this middleware ever sees
    // the request (req.url here is e.g. "/health", not "/api/health"), so the
    // target itself has to carry "/api" back on, or every proxied request
    // loses it and 404s against the backend.
    target: `${backendTarget}/api`,
    changeOrigin: true,
    // Cookies must pass through untouched in both directions: the browser's
    // Cookie header forwarded to the backend, and the backend's Set-Cookie
    // forwarded back to the browser. http-proxy-middleware does this by
    // default as long as we don't rewrite cookie domain/path, which we don't
    // need to here since the proxy target's cookie Domain is unset (host-only
    // cookie) and Path is "/" already.
    on: {
      proxyReq: (proxyReq, req) => {
        // Explicit passthrough for clarity — express-session reads this
        // straight off the incoming request, http-proxy-middleware already
        // forwards headers by default, but keep this so a future change to
        // this file makes the requirement obvious rather than silently
        // relying on a default.
        if (req.headers.cookie) {
          proxyReq.setHeader("cookie", req.headers.cookie);
        }
      }
    }
  })
);

app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback: any non-API, non-static-file route serves index.html so
// client-side routing (react-router) works on a hard refresh / deep link.
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`[STARTUP] Frontend listening on port ${port}, proxying /api to ${backendTarget}`);
});

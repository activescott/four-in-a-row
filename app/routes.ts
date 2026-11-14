import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.ts"),
  route("profile", "routes/profile.tsx"),
  route("auth/:provider/:action", "routes/auth.$provider.$action.ts"),
  route("e2e/captured-email", "routes/e2e.captured-email.ts"),
  route("ops/health/liveness", "routes/ops.health.liveness.ts"),
  route("ops/health/readiness", "routes/ops.health.readiness.ts"),
] satisfies RouteConfig;

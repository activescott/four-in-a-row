import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("ops/health/liveness", "routes/ops.health.liveness.ts"),
  route("ops/health/readiness", "routes/ops.health.readiness.ts"),
] satisfies RouteConfig;

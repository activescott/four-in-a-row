import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("healthz", "routes/healthz.ts"),
  route("readyz", "routes/readyz.ts"),
] satisfies RouteConfig;

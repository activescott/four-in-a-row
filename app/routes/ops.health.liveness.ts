// Liveness: answers without touching the database.
export function loader() {
  return Response.json({ status: "ok" });
}

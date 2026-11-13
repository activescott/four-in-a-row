import { handleAuth } from "../auth.server";
import type { Route } from "./+types/auth.$provider.$action";

// Every /auth/:provider/:action endpoint: email initiate and verify (with the
// magic-link confirm page), and the passkey options and verify calls.
export const loader = ({ request }: Route.LoaderArgs) =>
  handleAuth({ request });
export const action = ({ request }: Route.ActionArgs) =>
  handleAuth({ request });

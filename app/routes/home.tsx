import { redirect, useSearchParams } from "react-router";
import { getSession } from "../auth.server";
import { ConceptA } from "../landing/concept-a";
import { ConceptB } from "../landing/concept-b";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "Four in a Row" }];
}

// Same as /login: someone already signed in has nothing to do here.
export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect("/games");
  return null;
}

// Concept review only: /?concept=b shows direction B, anything else A.
export default function Home() {
  const [params] = useSearchParams();
  return params.get("concept") === "b" ? <ConceptB /> : <ConceptA />;
}

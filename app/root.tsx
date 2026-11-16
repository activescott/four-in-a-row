import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { optionalAuth } from "./auth.server";
import { Header } from "./header";
import type { Route } from "./+types/root";
import "./app.css";

export async function loader({ request }: Route.LoaderArgs) {
  return { email: (await optionalAuth(request))?.email ?? null };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-amber-50 text-slate-900">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// The page's own <main> fills what the header leaves, so short pages don't scroll.
export default function App() {
  const { email } = useLoaderData<typeof loader>();
  return (
    <div className="flex min-h-screen flex-col [&>main]:min-h-0 [&>main]:w-full [&>main]:flex-1">
      <Header email={email} />
      <Outlet />
    </div>
  );
}

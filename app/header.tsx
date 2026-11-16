import { useEffect, useRef } from "react";
import { Form, Link, useLocation } from "react-router";

const item =
  "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-slate-900 hover:bg-amber-100";

// A native <details> works by tap and by keyboard (Enter or Space on the
// summary); it only needs Escape and a close after navigating, added here.
function AccountMenu({ email }: { email: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  return (
    <details
      ref={menu}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !menu.current?.open) return;
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-1 [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Account menu for {email}</span>
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full bg-blue-700 text-lg font-semibold text-white"
        >
          {email.charAt(0).toUpperCase()}
        </span>
        <span
          aria-hidden="true"
          className="hidden max-w-[12rem] truncate text-slate-700 sm:inline"
        >
          {email}
        </span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-slate-300 bg-white p-1 shadow-lg">
        <p className="px-3 py-1 text-sm break-all text-slate-600">{email}</p>
        <Link to="/profile" className={item}>
          Profile
        </Link>
        <Form method="post" action="/logout" reloadDocument>
          <button type="submit" className={item}>
            Sign out
          </button>
        </Form>
      </div>
    </details>
  );
}

export function Header({ email }: { email: string | null }) {
  const { pathname } = useLocation();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4">
        <Link
          to={email ? "/games" : "/"}
          className="flex min-h-11 items-center text-xl font-bold text-slate-900"
        >
          Four in a Row
        </Link>
        {email ? (
          <AccountMenu email={email} />
        ) : (
          pathname !== "/login" && (
            <Link
              to="/login"
              className="flex min-h-11 items-center rounded-lg px-3 font-medium text-blue-800 underline"
            >
              Sign in
            </Link>
          )
        )}
      </div>
    </header>
  );
}

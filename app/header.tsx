import { useEffect, useRef } from "react";
import { Form, Link, useLocation } from "react-router";

const item =
  "flex min-h-11 w-full items-center rounded-lg px-3 text-left text-base text-slate-900 hover:bg-amber-100";

// A native <details> works by tap and by keyboard (Enter or Space on the
// summary); it only needs the closes added here: Escape, a tap or click
// outside, focus moving out, and a navigation.
function AccountMenu({ email }: { email: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const { key } = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [key]);
  useEffect(() => {
    const close = (event: Event) => {
      if (menu.current && !menu.current.contains(event.target as Node)) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <details
      ref={menu}
      className="relative"
      onBlur={(event) => {
        const to = event.relatedTarget as Node | null;
        if (to && !event.currentTarget.contains(to)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !menu.current?.open) return;
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg [&::-webkit-details-marker]:hidden">
        <span className="flex size-11 items-center justify-center rounded-full bg-blue-700 text-lg font-semibold text-white">
          {email.charAt(0).toUpperCase()}
        </span>
        <span className="text-slate-700">Account</span>
        <svg
          viewBox="0 0 20 20"
          className="size-4 text-slate-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-max min-w-[16rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-300 bg-white p-1 shadow-lg">
        <p className="px-3 py-1 text-sm break-words text-slate-600">{email}</p>
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
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4">
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

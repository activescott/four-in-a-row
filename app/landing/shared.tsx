import { Link } from "react-router";

// Same wording as /login's note and its email sign-in.
export const PRIVACY =
  "We use your email only to sign you in and send your game emails. We never share or sell it.";

export const STEPS = [
  {
    title: "Sign in",
    text: "We email you a link or a code. No password to remember.",
  },
  {
    title: "Invite someone",
    text: "Type their email. They get a link to join, and you move first.",
  },
  {
    title: "Take turns",
    text: "Play at your own pace. We email you when it’s your turn.",
  },
];

export function SignIn({
  className = "",
  children = "Sign in",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      to="/login"
      className={`flex min-h-14 items-center justify-center rounded-xl bg-blue-700 px-8 py-3 text-xl font-semibold text-white hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-blue-700 ${className}`}
    >
      {children}
    </Link>
  );
}

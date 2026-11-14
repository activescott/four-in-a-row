import { createPasskeyClient } from "@activescott/auth-provider-passkey/browser";

// Browser-only (the .client suffix keeps it out of the server bundle). The
// default basePath "/auth" matches routes/auth.$provider.$action.ts.
export const passkeys = createPasskeyClient();

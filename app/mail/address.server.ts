// Which addresses the app will send mail to (#76). The send limits count an
// address by a bucket key, and the mailer (nodemailer) parses the address it is
// given with RFC 5322 rules: it drops `(comments)`, unescapes `\x`, and joins
// `"quoted".parts`, so `victim(1)@x` and `victim@x` reach one inbox. Rather
// than teach the key every such spelling, an address that uses any of them is
// refused, everywhere mail is sent. What passes is a plain `local@domain`
// whose local part is a plain run of characters or wholly one quoted string,
// so the string that is keyed is the string that is delivered to.

/** Characters that give an address more than one reading. */
const UNSAFE = /[\s\p{Cc}()\\<>,;:[\]]/u;

export function isDeliverableAddress(address: string): boolean {
  if (UNSAFE.test(address)) return false;
  const parts = address.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (!local || !domain || domain.includes('"')) return false;
  if (local.startsWith('"')) {
    return (
      local.length > 2 &&
      local.endsWith('"') &&
      !local.slice(1, -1).includes('"')
    );
  }
  return !local.includes('"');
}

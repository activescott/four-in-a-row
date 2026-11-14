// A minimal browser cookie jar for driving route modules in tests: it keeps
// name=value pairs from Set-Cookie and drops any that a response expires.
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header
        .split(";")
        .map((part) => part.trim());
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const expired = attributes.some(
        (attribute) =>
          /^max-age=0$/i.test(attribute) ||
          (/^expires=/i.test(attribute) &&
            new Date(attribute.slice("expires=".length)).getTime() <
              Date.now()),
      );
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  has(name: string) {
    return this.cookies.has(name);
  }

  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

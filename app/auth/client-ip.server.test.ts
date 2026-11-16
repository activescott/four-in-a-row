import { expect, test } from "vitest";
import { ipKey } from "./client-ip.server";

test.each([
  ["::ffff:1.2.3.4", "1.2.3.4"],
  ["::ffff:102:304", "1.2.3.4"],
  ["::FFFF:0102:0304", "1.2.3.4"],
  ["0:0:0:0:0:ffff:102:304", "1.2.3.4"],
  ["[::ffff:102:304]:443", "1.2.3.4"],
  ["::ffff:c633:642c", "198.51.100.44"],
])("%s is bucketed as the IPv4 address %s", (ip, key) => {
  expect(ipKey(ip)).toBe(key);
});

test("other IPv6 addresses are reduced to their /64, and a missing one is unknown", () => {
  expect(ipKey("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
  expect(ipKey("::ffff:102:304:5")).not.toBe("1.2.3.4");
  expect(ipKey("203.0.113.9:5000")).toBe("203.0.113.9");
  expect(ipKey(null)).toBe("unknown");
});

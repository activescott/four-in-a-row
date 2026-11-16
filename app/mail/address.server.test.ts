import { expect, test } from "vitest";
import { isDeliverableAddress } from "./address.server";

test.each([
  "victim@example.com",
  "victim+tag@example.com",
  "v.i.c.t.i.m@gmail.com",
  '"victim+1"@example.com',
  "bücher@bücher.de",
  "victim@xn--bcher-kva.de",
])("accepts %s", (address) => {
  expect(isDeliverableAddress(address)).toBe(true);
});

test.each([
  "victim(c1)@example.com",
  "(c)victim@example.com",
  "victim@example.com(x)",
  '"v\\ictim"@example.com',
  '"vic".tim@example.com',
  'vic."tim"@example.com',
  'vi"c@example.com',
  '"victim"x@example.com',
  "vic tim@example.com",
  '"vic tim"@example.com',
  "victim@exa mple.com",
  "victim@example.com\t",
  "a@example.com,victim@example.org",
  "<victim@example.com>",
  "a;b@example.com",
  "a:b@example.com",
  "victim@example.com\\",
])("refuses %j", (address) => {
  expect(isDeliverableAddress(address)).toBe(false);
});

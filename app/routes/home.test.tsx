import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import Home from "./home";

test("home page says Four in a Row", () => {
  expect(renderToString(<Home />)).toContain("Four in a Row");
});

import { Fragment } from "react";

/**
 * Text that may wrap after each @ and . (so a long address breaks at
 * margaret.henderson@ / example. / com, not inside a word). The words stay
 * in one piece for copying; pair with break-words as the last resort for a
 * single part that is wider than the line.
 */
export function Wrappable({ text }: { text: string }) {
  return text.split(/(?<=[@.])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

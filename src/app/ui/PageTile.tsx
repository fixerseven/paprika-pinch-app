import { monogram } from "@/lib/pages";

/** A page's two-letter tile in its own colour. Letters carry the identity; colour only helps. */
export default function PageTile({ name, colour, large }: { name: string; colour: string; large?: boolean }) {
  return (
    <i className={`mono${large ? " lg" : ""}`} style={{ "--c": colour } as React.CSSProperties} aria-hidden>
      {monogram(name)}
    </i>
  );
}

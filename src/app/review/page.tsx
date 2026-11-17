import Link from "next/link";
import { getDb } from "@/lib/db";
import { listBrands } from "@/lib/queries";
import { getReviewStack } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import ReviewStack from "./ReviewStack";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; held?: string }>;
}) {
  const { brand, held } = await searchParams;
  await requireApprover(`/review${brand ? `?brand=${brand}` : ""}`);
  const db = getDb();
  const brands = listBrands(db);
  const cards = getReviewStack(db, { brand: brand || undefined, includeHeld: held === "1" });
  const q = (b?: string, h?: string) => {
    const s = new URLSearchParams();
    if (b) s.set("brand", b);
    if (h) s.set("held", h);
    const str = s.toString();
    return `/review${str ? `?${str}` : ""}`;
  };

  return (
    <div className="review-page">
      <div className="chips" role="tablist" aria-label="Brand">
        <Link href={q(undefined, held)} className={`chip ${!brand ? "chip-on" : ""}`}>
          All
        </Link>
        {brands.map((b) => (
          <Link
            key={b.slug}
            href={q(b.slug, held)}
            className={`chip ${brand === b.slug ? "chip-on" : ""}`}
            style={{ "--brand": b.colour } as React.CSSProperties}
          >
            <span className="brand-dot" aria-hidden />
            {b.name}
          </Link>
        ))}
        <Link href={q(brand, held === "1" ? undefined : "1")} className={`chip ${held === "1" ? "chip-on" : ""}`}>
          {held === "1" ? "Hiding nothing" : "Show on hold"}
        </Link>
      </div>
      <ReviewStack key={`${brand ?? ""}-${held ?? ""}`} initial={cards} />
    </div>
  );
}

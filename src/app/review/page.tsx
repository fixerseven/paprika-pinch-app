import { getDb } from "@/lib/db";
import { getReviewStack } from "@/lib/review";
import { requireApprover } from "@/lib/session";
import { listBrands } from "@/lib/queries";
import { pageRules } from "@/lib/brands";
import { MANY_PAGES, orderByPage } from "@/lib/pages";
import { todayIn } from "@/lib/time";
import ReviewStack from "./ReviewStack";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; held?: string; from?: string }>;
}) {
  const { brand, held, from } = await searchParams;
  const q = new URLSearchParams();
  if (brand) q.set("brand", brand);
  if (held) q.set("held", held);
  if (from) q.set("from", from);
  await requireApprover(`/review${q.size ? `?${q}` : ""}`);
  const db = getDb();
  const many = listBrands(db).length >= MANY_PAGES;
  let cards = getReviewStack(db, { brand: brand || undefined, includeHeld: held === "1" });
  if (held === "1") cards = cards.filter((c) => c.state === "held");
  // With many pages, review goes page by page so you aren't switching voice and rules on every post.
  if (many) cards = orderByPage(cards);
  // Opening a row from the inbox starts the pile at that post; the rest follow in order.
  const at = cards.findIndex((c) => String(c.id) === from);
  if (at > 0) cards = [...cards.slice(at), ...cards.slice(0, at)];
  return (
    <ReviewStack
      key={`${brand ?? ""}-${held ?? ""}-${from ?? ""}`}
      initial={cards}
      today={todayIn("Asia/Manila")}
      many={many}
      rules={pageRules()}
    />
  );
}

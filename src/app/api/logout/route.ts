import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";

export async function POST() {
  // Relative Location: behind `tailscale serve` the request URL is localhost.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.delete(COOKIE);
  return res;
}

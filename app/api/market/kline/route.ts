import { NextResponse } from "next/server";
import { fetchTencentKline, K_TYPES, normalizeCode, type KType } from "../../../lib/tencent-technical";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stockCode = (url.searchParams.get("stock_code") ?? "").trim();
  const kType = (url.searchParams.get("k_type") ?? "day") as KType;
  const rawCount = Number(url.searchParams.get("num") ?? "200");

  if (!normalizeCode(stockCode)) {
    return NextResponse.json({ error: "请输入 6 位股票或 ETF 代码" }, { status: 400 });
  }
  if (!K_TYPES.includes(kType)) {
    return NextResponse.json({ error: "不支持的 K 线周期" }, { status: 400 });
  }
  if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > (kType.startsWith("m") && kType !== "month" ? 320 : 640)) {
    return NextResponse.json({ error: "K 线数量超出允许范围" }, { status: 400 });
  }

  try {
    const result = await fetchTencentKline(stockCode, kType, rawCount);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "行情数据请求失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

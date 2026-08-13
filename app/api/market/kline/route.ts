import { NextResponse } from "next/server";
import { fetchTencentKline, K_TYPES, type KType } from "../../../lib/tencent-technical";

const STOCK_CODE = /^(?:(?:sh|sz|hk|us)?[a-z0-9]{1,12})$/i;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stockCode = (url.searchParams.get("stock_code") ?? "").trim();
  const kType = (url.searchParams.get("k_type") ?? "day") as KType;
  const rawCount = Number(url.searchParams.get("num") ?? "200");

  if (!STOCK_CODE.test(stockCode)) {
    return NextResponse.json({ error: "股票代码格式不正确" }, { status: 400 });
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

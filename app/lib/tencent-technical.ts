export const K_TYPES = ["day", "week", "month", "m1", "m5", "m15", "m30", "m60"] as const;
export type KType = (typeof K_TYPES)[number];

export type KlineRow = {
  date: string;
  open: number | null;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  volumeUnit: "手";
  volumeRaw: number | null;
  volumeRawUnit: "手" | "股";
  ma?: Record<string, number | null>;
  boll?: { upper: number | null; middle: number | null; lower: number | null };
  rsi?: Record<string, number | null>;
  macd?: { dif: number | null; dea: number | null; histogram: number | null };
};

export type TencentKlineResult = {
  status: "success" | "error";
  stockCode: string;
  kType: KType;
  fetchTime: string;
  total: number;
  kline: KlineRow[];
  indicators: string[];
  error?: string;
};

const DAILY_URL = "http://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const MINUTE_URL = "http://ifzq.gtimg.cn/appstock/app/kline/mkline";
const DEFAULT_INDICATORS = ["ma", "boll", "rsi", "macd"];

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCode(input: string): string {
  const code = input.trim().toLowerCase().replaceAll(".", "");
  if (/^(sh|sz|hk|us)/.test(code)) return code;
  if (/^[a-z]+$/.test(code)) return `us${code}`;
  if (/^\d+$/.test(code)) {
    if (code.length < 6) return `hk${code}`;
    if (code.startsWith("6")) return `sh${code}`;
    if (code.startsWith("0") || code.startsWith("3")) return `sz${code}`;
  }
  return "";
}

type TencentPayload = { data?: Record<string, Record<string, unknown>> };

function jsonpPayload(text: string): TencentPayload {
  const payload = text.slice(text.indexOf("=") + 1);
  const parsed: unknown = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object") throw new Error("腾讯财经返回格式异常");
  return parsed as TencentPayload;
}

function normalizeVolume(code: string, volume: number | null): { volume: number | null; unit: "手" | "股" } {
  if (volume === null) return { volume: null, unit: code.startsWith("sh688") ? "股" : "手" };
  return code.startsWith("sh688") ? { volume: volume / 100, unit: "股" } : { volume, unit: "手" };
}

function makeRow(code: string, item: unknown[], minute = false): KlineRow | null {
  if (item.length < 6) return null;
  const rawVolume = numberOrNull(item[5]);
  const normalized = normalizeVolume(code, rawVolume);
  const rawDate = String(item[0] ?? "");
  const date = minute && /^\d{12}$/.test(rawDate)
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)} ${rawDate.slice(8, 10)}:${rawDate.slice(10, 12)}`
    : rawDate;
  return {
    date,
    open: numberOrNull(item[1]),
    close: numberOrNull(item[2]),
    high: numberOrNull(item[3]),
    low: numberOrNull(item[4]),
    volume: normalized.volume,
    volumeUnit: "手",
    volumeRaw: rawVolume,
    volumeRawUnit: normalized.unit,
  };
}

async function fetchRows(code: string, kType: KType, count: number): Promise<KlineRow[]> {
  const random = Math.random().toString().slice(2, 18);
  let url: string;
  let minute = false;
  if (kType.startsWith("m") && kType !== "month") {
    minute = true;
    const period = kType.slice(1);
    url = `${MINUTE_URL}?param=${code},m${period},,${Math.min(count, 320)}&_var=m${period}_today&r=0.${random}`;
  } else {
    const safeCount = Math.min(count, 640);
    url = `${DAILY_URL}?_var=kline_${kType}qfq&param=${code},${kType},,,${safeCount},qfq&r=0.${random}`;
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 grid-win market data" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`腾讯财经请求失败（HTTP ${response.status}）`);
  const data = jsonpPayload(await response.text());
  const stockData = data.data?.[code] ?? {};
  const raw = minute
    ? stockData[`m${kType.slice(1)}`]
    : stockData[`qfq${kType}`] ?? stockData[kType];
  if (!Array.isArray(raw)) throw new Error("腾讯财经没有返回该股票的 K 线数据");
  return (raw as unknown[][]).map((item) => makeRow(code, item, minute)).filter((item): item is KlineRow => item !== null);
}

function closes(rows: KlineRow): number[];
function closes(rows: KlineRow[]): number[];
function closes(rows: KlineRow | KlineRow[]): number[] {
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map((row) => row.close).filter((value): value is number => value !== null);
}

function addIndicators(rows: KlineRow[]): void {
  const closeValues = closes(rows);
  const changes = closeValues.slice(1).map((value, index) => value - closeValues[index]);
  let ema12: number | null = null;
  let ema26: number | null = null;
  let dea: number | null = null;
  rows.forEach((row, index) => {
    const ma: Record<string, number | null> = {};
    for (const period of [5, 10, 20, 60]) {
      const window = closeValues.slice(index - period + 1, index + 1);
      ma[`ma${period}`] = window.length === period ? round(window.reduce((sum, value) => sum + value, 0) / period) : null;
    }
    row.ma = ma;

    const bollWindow = closeValues.slice(index - 19, index + 1);
    if (bollWindow.length === 20) {
      const middle = bollWindow.reduce((sum, value) => sum + value, 0) / 20;
      const variance = bollWindow.reduce((sum, value) => sum + (value - middle) ** 2, 0) / 20;
      const deviation = Math.sqrt(variance);
      row.boll = { upper: round(middle + 2 * deviation), middle: round(middle), lower: round(middle - 2 * deviation) };
    } else {
      row.boll = { upper: null, middle: null, lower: null };
    }

    const rsi: Record<string, number | null> = {};
    for (const period of [6, 12, 14, 24]) {
      const window = changes.slice(index - period, index);
      if (window.length !== period) {
        rsi[`rsi${period}`] = null;
        continue;
      }
      const gains = window.filter((change) => change > 0).reduce((sum, value) => sum + value, 0) / period;
      const losses = window.filter((change) => change < 0).reduce((sum, value) => sum - value, 0) / period;
      rsi[`rsi${period}`] = losses === 0 ? 100 : round(100 - 100 / (1 + gains / losses), 2);
    }
    row.rsi = rsi;

    if (row.close === null) {
      row.macd = { dif: null, dea: null, histogram: null };
    } else {
      ema12 = ema12 === null ? row.close : ema12 * 11 / 13 + row.close * 2 / 13;
      ema26 = ema26 === null ? row.close : ema26 * 25 / 27 + row.close * 2 / 27;
      const dif = ema12 - ema26;
      dea = dea === null ? dif : dea * 8 / 10 + dif * 2 / 10;
      row.macd = { dif: round(dif), dea: round(dea), histogram: round(2 * (dif - dea)) };
    }
  });
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export async function fetchTencentKline(stockCode: string, kType: KType = "day", count = 200): Promise<TencentKlineResult> {
  const code = normalizeCode(stockCode);
  if (!code) throw new Error("无法识别的股票代码");
  const rows = await fetchRows(code, kType, count);
  addIndicators(rows);
  return {
    status: "success",
    stockCode: code,
    kType,
    fetchTime: new Date().toISOString(),
    total: rows.length,
    kline: rows,
    indicators: DEFAULT_INDICATORS,
  };
}

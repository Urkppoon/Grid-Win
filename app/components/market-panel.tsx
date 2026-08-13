"use client";

import * as echarts from "echarts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KlineRow, KType, TencentKlineResult } from "../lib/tencent-technical";

const K_TYPES: Array<{ value: KType; label: string }> = [
  { value: "day", label: "日 K" }, { value: "week", label: "周 K" }, { value: "month", label: "月 K" },
  { value: "m1", label: "1 分钟" }, { value: "m5", label: "5 分钟" }, { value: "m15", label: "15 分钟" }, { value: "m30", label: "30 分钟" }, { value: "m60", label: "60 分钟" },
];

const PRIMARY_K_TYPES: KType[] = ["day", "m60", "m15", "m5"];
const PRIMARY_K_TYPE_LABELS: Record<KType, string> = {
  day: "日线", week: "周线", month: "月线", m1: "1分", m5: "5分", m15: "15分", m30: "30分", m60: "60分",
};
const EXTRA_K_TYPES = K_TYPES.filter((item) => !PRIMARY_K_TYPES.includes(item.value));

const numberText = (value: number | null | undefined, digits = 2) => value == null ? "—" : value.toFixed(digits);
const volumeText = (value: number | null | undefined) => value == null ? "—" : value >= 1e8 ? `${(value / 1e8).toFixed(1)}亿` : value >= 1e4 ? `${(value / 1e4).toFixed(0)}万` : Math.round(value).toLocaleString();
const fetchTimeText = (value: string | undefined) => value ? value.replace("T", " ").replace(/\.\d+Z$/, "") : "—";

type ChartPoint = { seriesName: string; data?: unknown; dataIndex?: number; value?: number | null; color?: string; axisValue?: string };

export type GridParams = {
  lowerLimit: number;
  basePrice: number;
  upperLimit: number;
  buyStep: number;
  sellStep: number;
  mode: "price" | "ratio";
};

type GridLevel = { price: number; type: "base" | "buy" | "sell" | "upper" | "lower"; label: string };

function calculateGridOverlay({ lowerLimit, basePrice, upperLimit, buyStep, sellStep, mode }: GridParams, quietMode = false) {
  const levels: GridLevel[] = [];
  const addLevels = (direction: "buy" | "sell", limit: number, step: number) => {
    for (let count = 1; count <= 50; count += 1) {
      const raw = mode === "price"
        ? basePrice + (direction === "buy" ? -step : step) * count
        : basePrice * Math.pow(1 + (direction === "buy" ? -step : step) / 100, count);
      const price = Math.round((raw + Number.EPSILON) * 100) / 100;
      if ((direction === "buy" && price < limit - 0.001) || (direction === "sell" && price > limit + 0.001)) break;
      levels.push({ price, type: Math.abs(price - limit) < 0.001 ? (direction === "buy" ? "lower" : "upper") : direction, label: `${direction === "buy" ? "买" : "卖"} ${price.toFixed(2)}` });
    }
  };
  if (basePrice > 0 && lowerLimit < basePrice && upperLimit > basePrice && buyStep > 0 && sellStep > 0) {
    addLevels("buy", lowerLimit, buyStep);
    levels.push({ price: basePrice, type: "base", label: `基准 ${basePrice.toFixed(2)}` });
    addLevels("sell", upperLimit, sellStep);
    if (!levels.some((item) => Math.abs(item.price - lowerLimit) < 0.001)) levels.push({ price: lowerLimit, type: "lower", label: `下限 ${lowerLimit.toFixed(2)}` });
    if (!levels.some((item) => Math.abs(item.price - upperLimit) < 0.001)) levels.push({ price: upperLimit, type: "upper", label: `上限 ${upperLimit.toFixed(2)}` });
  }
  return levels.map((item) => {
    const color = quietMode ? (item.type === "base" ? "#D1D1D6" : "#636366") : item.type === "base" ? "#FFD60A" : item.type === "buy" || item.type === "lower" ? "#30D158" : "#FF453A";
    return { yAxis: item.price, lineStyle: { color, width: item.type === "base" || item.type === "upper" || item.type === "lower" ? 1.5 : 1, type: item.type === "base" || item.type === "upper" || item.type === "lower" ? "solid" as const : "dashed" as const }, label: { show: true, position: "end" as const, formatter: item.type === "upper" || item.type === "lower" ? item.label.replace(/^[买卖]/, item.type === "upper" ? "上限" : "下限") : item.label, backgroundColor: color, color: item.type === "base" ? "#000" : "#fff", fontSize: 10, fontWeight: "bold" as const, borderRadius: 4, padding: [3, 7], distance: 8 } };
  });
}

function baseChartOption(dates: string[]) {
  return {
    animation: false,
    backgroundColor: "#121214",
    textStyle: { color: "#8E8E93", fontSize: 11, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
    grid: { top: 70, right: 70, bottom: 60, left: 70 },
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "cross" as const, crossStyle: { color: "#8E8E93" } },
      backgroundColor: "#1C1C1E", borderColor: "#2C2C2E",
      textStyle: { color: "#F5F5F7", fontSize: 11, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', ui-monospace, SFMono-Regular, monospace" },
    },
    xAxis: {
      type: "category" as const, data: dates,
      axisLine: { lineStyle: { color: "#2C2C2E" } }, axisTick: { show: false },
      axisLabel: { color: "#8E8E93", fontSize: 10, rotate: dates.length > 60 ? 45 : 0 },
    },
  };
}

function KlineChart({ rows, gridParams, showGrid, showMa, showBoll, quietMode, onDataIndex, onChartInstance }: { rows: KlineRow[]; gridParams: GridParams; showGrid: boolean; showMa: boolean; showBoll: boolean; quietMode: boolean; onDataIndex: (index: number) => void; onChartInstance?: (chart: echarts.ECharts | null) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  // Effect 1: 初始化图表 — 仅在行情数据变化时重建
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const chart = echarts.init(element, "dark");
    chartInstanceRef.current = chart;
    onChartInstance?.(chart);
    const dates = rows.map((row) => row.date);
    const ohlc = rows.map((row) => [row.open, row.close, row.low, row.high]);
    const highest = rows.reduce<{ index: number; value: number } | null>((result, row, index) => row.high != null && (result == null || row.high > result.value) ? { index, value: row.high } : result, null);
    const lowest = rows.reduce<{ index: number; value: number } | null>((result, row, index) => row.low != null && (result == null || row.low < result.value) ? { index, value: row.low } : result, null);
    const ma = [5, 10, 20, 60].map((period) => ({ name: `MA${period}`, data: rows.map((row) => row.ma?.[`ma${period}`] ?? null) }));
    const boll = [
      { name: "BOLL 上轨", data: rows.map((row) => row.boll?.upper ?? null), color: quietMode ? "#64748B" : "#1DA1D2" },
      { name: "BOLL 中轨", data: rows.map((row) => row.boll?.middle ?? null), color: quietMode ? "#94A3B8" : "#FFD60A" },
      { name: "BOLL 下轨", data: rows.map((row) => row.boll?.lower ?? null), color: quietMode ? "#64748B" : "#FF5C8A" },
    ];
    const option = baseChartOption(dates);
    const zoomStart = dates.length > 50 ? Math.max(0, Math.round(((dates.length - 50) / dates.length) * 100)) : 0;
    chart.setOption({
      ...option,
      grid: { top: 70, right: 75, bottom: 65, left: 60 },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0],
          start: zoomStart,
          end: 100,
        },
        {
          type: "slider",
          xAxisIndex: [0],
          bottom: 12,
          height: 18,
          borderColor: "#2C2C2E",
          backgroundColor: "#121214",
          fillerColor: "rgba(10, 132, 255, 0.2)",
          handleStyle: { color: "#0A84FF", borderColor: "#0A84FF" },
          moveHandleStyle: { color: "#0A84FF" },
          selectedDataBackground: { lineStyle: { color: "#0A84FF" }, areaStyle: { color: "#0A84FF33" } },
          textStyle: { color: "#8E8E93", fontSize: 10 },
          start: zoomStart,
          end: 100,
        },
      ],
      yAxis: [{ type: "value", scale: true, splitLine: { lineStyle: { color: "#1C1C1E" } }, axisLine: { lineStyle: { color: "#2C2C2E" } }, axisLabel: { color: "#8E8E93", fontSize: 10 }, position: "right" }],
      series: [
        {
          name: "K线", type: "candlestick", data: ohlc,
          itemStyle: quietMode
            ? { color: "#121214", color0: "#3A3A3C", borderColor: "#D1D1D6", borderColor0: "#636366" }
            : { color: "#FF453A", color0: "#30D158", borderColor: "#FF453A", borderColor0: "#30D158" },
          markPoint: {
            symbol: "pin",
            symbolSize: 36,
            label: { color: "#F5F5F7", fontSize: 10, fontWeight: 700, formatter: ({ data }: { data?: { name?: string; value?: number } }) => `${data?.name ?? ""}\n${numberText(data?.value)}` },
            data: [
              ...(highest ? [{ name: "阶段最高", coord: [dates[highest.index], highest.value], value: highest.value, itemStyle: { color: quietMode ? "#8E8E93" : "#FF453A" } }] : []),
              ...(lowest ? [{ name: "阶段最低", coord: [dates[lowest.index], lowest.value], value: lowest.value, itemStyle: { color: quietMode ? "#636366" : "#30D158" } }] : []),
            ],
          },
          markLine: { symbol: ["none", "none"], silent: false, animation: false, data: showGrid ? calculateGridOverlay(gridParams, quietMode) : [] },
        },
        ...(showMa ? ma.map(({ name, data }) => {
          const color = quietMode
            ? ({ MA5: "#A1A1AA", MA10: "#8E8E93", MA20: "#71717A", MA60: "#52525B" } as Record<string, string>)[name]
            : ({ MA5: "#5470C6", MA10: "#B8DE29", MA20: "#64649A", MA60: "#FF9E4A" } as Record<string, string>)[name];
          return { name, type: "line", data, smooth: true, symbol: "none", itemStyle: { color }, lineStyle: { color, width: 1.15, type: name === "MA60" ? "dashed" as const : "solid" as const } };
        }) : []),
        ...(showBoll ? boll.map(({ name, data, color }) => ({ name, type: "line", data, smooth: false, symbol: "none", itemStyle: { color }, lineStyle: { color, width: 1.5, type: name === "BOLL 中轨" ? "solid" as const : "dashed" as const } })) : []),
      ],
      tooltip: {
        ...option.tooltip,
        formatter: (raw: unknown) => {
          const points = (Array.isArray(raw) ? raw : []) as ChartPoint[];
          const first = points[0];
          const candlePoint = points.find((point) => point.seriesName === "K线");
          const candleRow = candlePoint?.dataIndex == null ? null : rows[candlePoint.dataIndex];
          let html = `<div style="font-weight:700;margin-bottom:4px">${first?.axisValue ?? ""}</div>`;
          for (const point of points) {
            if (point.seriesName === "K线") {
              html += candleRow
                ? `开:${numberText(candleRow.open)} 收:${numberText(candleRow.close)}<br/>高:${numberText(candleRow.high)} 低:${numberText(candleRow.low)}<br/>`
                : "K线数据暂不可用<br/>";
            } else if (point.value != null) {
              html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${point.color ?? "#4B5563"};margin-right:4px"></span>${point.seriesName}: ${numberText(point.value)}<br/>`;
            }
          }
          return html;
        },
      },
    });
    chart.on("click", (params: { dataIndex?: number }) => { if (params.dataIndex != null) onDataIndex(params.dataIndex); });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chartInstanceRef.current = null; onChartInstance?.(null); chart.dispose(); };
  }, [rows, gridParams, showGrid, showMa, showBoll, quietMode, onDataIndex, onChartInstance]);

  // Effect 2: 网格 Overlay 增量更新 — 仅刷新 markLine，不重建图表
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    chart.setOption({
      series: [{
        name: "K线",
        markLine: { symbol: ["none", "none"], silent: false, animation: false, data: showGrid ? calculateGridOverlay(gridParams, quietMode) : [] },
      }],
    });
  }, [gridParams, showGrid, quietMode]);

  return <div className="market-echart" ref={chartRef} aria-label="网格融合 K线图，含均线与布林带" />;
}

function RsiChart({ rows, onDataIndex, onChartInstance }: { rows: KlineRow[]; onDataIndex: (index: number) => void; onChartInstance?: (chart: echarts.ECharts | null) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const chart = echarts.init(element, "dark");
    onChartInstance?.(chart);
    const dates = rows.map((row) => row.date);
    const option = baseChartOption(dates);
    const zoomStart = dates.length > 50 ? Math.max(0, Math.round(((dates.length - 50) / dates.length) * 100)) : 0;
    chart.setOption({
      ...option, grid: { top: 40, right: 75, bottom: 50, left: 60 },
      dataZoom: [
        { type: "inside", xAxisIndex: [0], start: zoomStart, end: 100 },
        {
          type: "slider",
          xAxisIndex: [0],
          bottom: 8,
          height: 16,
          borderColor: "#2C2C2E",
          backgroundColor: "#121214",
          fillerColor: "rgba(10, 132, 255, 0.2)",
          handleStyle: { color: "#0A84FF", borderColor: "#0A84FF" },
          textStyle: { color: "#8E8E93", fontSize: 10 },
          start: zoomStart,
          end: 100,
        },
      ],
      yAxis: [{ type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: "#1C1C1E" } }, axisLine: { lineStyle: { color: "#2C2C2E" } }, axisLabel: { color: "#8E8E93", fontSize: 10 }, position: "right" }],
      series: [
        { name: "超买线 70", type: "line", data: [], markLine: { silent: true, symbol: "none", lineStyle: { color: "#555B63", type: "dashed", width: 1 }, label: { color: "#8E8E93", fontSize: 9 }, data: [{ yAxis: 70 }] } },
        { name: "超卖线 30", type: "line", data: [], markLine: { silent: true, symbol: "none", lineStyle: { color: "#555B63", type: "dashed", width: 1 }, label: { color: "#8E8E93", fontSize: 9 }, data: [{ yAxis: 30 }] } },
        ...[6, 12, 14, 24].map((period) => ({ name: `RSI${period}`, type: "line", data: rows.map((row) => row.rsi?.[`rsi${period}`] ?? null), smooth: true, symbol: "none", lineStyle: { color: ({ RSI6: "#FFAB40", RSI12: "#FF8A65", RSI14: "#CE93D8", RSI24: "#4FC3F7" } as Record<string, string>)[`RSI${period}`], width: 1.5 } })),
      ],
    });
    chart.on("click", (params: { dataIndex?: number }) => { if (params.dataIndex != null) onDataIndex(params.dataIndex); });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); onChartInstance?.(null); chart.dispose(); };
  }, [rows, onDataIndex, onChartInstance]);
  return <div className="market-echart market-rsi-chart" ref={chartRef} aria-label="RSI相对强弱指标图" />;
}

function VolumeMacdChart({ rows, quietMode, onDataIndex, onChartInstance }: { rows: KlineRow[]; quietMode: boolean; onDataIndex: (index: number) => void; onChartInstance?: (chart: echarts.ECharts | null) => void }) {
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const chart = echarts.init(element, "dark");
    onChartInstance?.(chart);
    const dates = rows.map((row) => row.date);
    const zoomStart = dates.length > 50 ? Math.max(0, Math.round(((dates.length - 50) / dates.length) * 100)) : 0;
    const upColor = quietMode ? "#8E8E93" : "#FF453A";
    const downColor = quietMode ? "#3A3A3C" : "#30D158";
    const axis = (showLabels: boolean) => ({
      type: "category" as const,
      data: dates,
      gridIndex: showLabels ? 1 : 0,
      axisLine: { lineStyle: { color: "#2C2C2E" } },
      axisTick: { show: false },
      axisLabel: { show: showLabels, color: "#8E8E93", fontSize: 10, rotate: dates.length > 60 ? 45 : 0 },
    });
    const valueAxis = (gridIndex: number, formatter?: (value: number) => string) => ({
      type: "value" as const,
      gridIndex,
      scale: true,
      splitNumber: 3,
      splitLine: { lineStyle: { color: "#1C1C1E" } },
      axisLine: { lineStyle: { color: "#2C2C2E" } },
      axisLabel: { color: "#8E8E93", fontSize: 10, formatter },
      position: "right" as const,
    });
    chart.setOption({
      animation: false,
      backgroundColor: "#121214",
      textStyle: { color: "#8E8E93", fontSize: 11, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif" },
      title: [
        { text: "VOLUME", left: 16, top: 7, textStyle: { color: "#8E8E93", fontSize: 10, fontWeight: 700 } },
        { text: "MACD (12, 26, 9)", left: 16, top: "45%", textStyle: { color: "#8E8E93", fontSize: 10, fontWeight: 700 } },
      ],
      legend: { data: ["DIF", "DEA"], top: "44%", right: 72, itemWidth: 14, itemHeight: 2, textStyle: { color: "#8E8E93", fontSize: 10 } },
      grid: [
        { top: 30, right: 75, height: "31%", left: 60 },
        { top: "52%", right: 75, bottom: 56, left: 60 },
      ],
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "cross" as const, crossStyle: { color: "#8E8E93" } },
        backgroundColor: "#1C1C1E",
        borderColor: "#2C2C2E",
        textStyle: { color: "#F5F5F7", fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, monospace" },
        formatter: (raw: unknown) => {
          const points = (Array.isArray(raw) ? raw : []) as ChartPoint[];
          const index = points[0]?.dataIndex;
          const row = index == null ? null : rows[index];
          if (!row) return "";
          return `<div style="font-weight:700;margin-bottom:4px">${row.date}</div>成交量: ${volumeText(row.volume)} 手<br/>DIF: ${numberText(row.macd?.dif, 3)}<br/>DEA: ${numberText(row.macd?.dea, 3)}<br/>MACD: ${numberText(row.macd?.histogram, 3)}`;
        },
      },
      xAxis: [axis(false), axis(true)],
      yAxis: [valueAxis(0, (value) => volumeText(value)), valueAxis(1)],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: zoomStart, end: 100 },
        {
          type: "slider", xAxisIndex: [0, 1], bottom: 10, height: 16,
          borderColor: "#2C2C2E", backgroundColor: "#121214", fillerColor: "rgba(10, 132, 255, 0.2)",
          handleStyle: { color: "#0A84FF", borderColor: "#0A84FF" }, moveHandleStyle: { color: "#0A84FF" },
          selectedDataBackground: { lineStyle: { color: "#0A84FF" }, areaStyle: { color: "#0A84FF33" } },
          textStyle: { color: "#8E8E93", fontSize: 10 }, start: zoomStart, end: 100,
        },
      ],
      series: [
        {
          name: "成交量", type: "bar", xAxisIndex: 0, yAxisIndex: 0, barMaxWidth: 8,
          data: rows.map((row) => ({ value: row.volume, itemStyle: { color: row.close != null && row.open != null && row.close >= row.open ? upColor : downColor } })),
        },
        {
          name: "MACD", type: "bar", xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 8,
          data: rows.map((row) => ({ value: row.macd?.histogram ?? null, itemStyle: { color: (row.macd?.histogram ?? 0) >= 0 ? upColor : downColor } })),
        },
        { name: "DIF", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: rows.map((row) => row.macd?.dif ?? null), symbol: "none", lineStyle: { color: quietMode ? "#A1A1AA" : "#FFD60A", width: 1.25 } },
        { name: "DEA", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: rows.map((row) => row.macd?.dea ?? null), symbol: "none", lineStyle: { color: quietMode ? "#636366" : "#0A84FF", width: 1.25 } },
      ],
    });
    chart.on("click", (params: { dataIndex?: number }) => { if (params.dataIndex != null) onDataIndex(params.dataIndex); });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); onChartInstance?.(null); chart.dispose(); };
  }, [rows, quietMode, onDataIndex, onChartInstance]);
  return <div className="market-echart market-volume-macd-chart" ref={chartRef} aria-label="成交量与MACD指标图，缩放窗口与K线同步" />;
}

export default function MarketPanel({ gridParams }: { gridParams: GridParams }) {
  const [stockCode, setStockCode] = useState("300408");
  const [kType, setKType] = useState<KType>("m15");
  const [count, setCount] = useState(200);
  const [countDraft, setCountDraft] = useState("200");
  const [data, setData] = useState<TencentKlineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const requestIdRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const klineInstanceRef = useRef<echarts.ECharts | null>(null);
  const volumeMacdInstanceRef = useRef<echarts.ECharts | null>(null);
  const rsiInstanceRef = useRef<echarts.ECharts | null>(null);

  const syncConnectCharts = () => {
    const charts = [klineInstanceRef.current, volumeMacdInstanceRef.current, rsiInstanceRef.current].filter((chart): chart is echarts.ECharts => chart !== null);
    if (charts.length > 1) echarts.connect(charts);
  };

  const handleKlineChartInstance = useCallback((chart: echarts.ECharts | null) => {
    klineInstanceRef.current = chart;
    syncConnectCharts();
  }, []);

  const handleRsiChartInstance = useCallback((chart: echarts.ECharts | null) => {
    rsiInstanceRef.current = chart;
    syncConnectCharts();
  }, []);

  const handleVolumeMacdChartInstance = useCallback((chart: echarts.ECharts | null) => {
    volumeMacdInstanceRef.current = chart;
    syncConnectCharts();
  }, []);

  const fetchKlineData = useCallback(async (code: string, type: KType, num: number) => {
    if (!code.trim()) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/market/kline?stock_code=${encodeURIComponent(code.trim())}&k_type=${type}&num=${num}`, { signal: controller.signal });
      const payload = await response.json() as TencentKlineResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "行情请求失败");
      if (requestId === requestIdRef.current) setData(payload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (requestId === requestIdRef.current) setError(caught instanceof Error ? caught.message : "行情请求失败");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // 页面加载完成后，默认自动拉取一次 300408 的 15 分钟行情
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchKlineData("300408", "m15", 200); }, 0);
    return () => { window.clearTimeout(timer); requestControllerRef.current?.abort(); };
  }, [fetchKlineData]);

  const handleKTypeChange = (newType: KType) => {
    setKType(newType);
    void fetchKlineData(stockCode, newType, count);
  };

  const commitCount = () => {
    const newCount = Number(countDraft);
    const max = kType.startsWith("m") ? 320 : 640;
    if (!Number.isInteger(newCount) || newCount < 1 || newCount > max) {
      setError(`K线数量需为 1–${max} 的整数；当前保留上次成功的行情。`);
      setCountDraft(String(count));
      return;
    }
    setCount(newCount);
    setCountDraft(String(newCount));
    void fetchKlineData(stockCode, kType, newCount);
  };

  const scrollTableTo = useMemo(() => (index: number) => {
    const row = tableRef.current?.querySelector<HTMLTableRowElement>(`tbody tr[data-index="${index}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    tableRef.current?.querySelectorAll("tbody tr").forEach((item) => item.classList.remove("market-row-selected"));
    row.classList.add("market-row-selected");
  }, []);

  const [showStatus, setShowStatus] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showMa, setShowMa] = useState(true);
  const [showBoll, setShowBoll] = useState(false);
  const [quietMode, setQuietMode] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showTable, setShowTable] = useState(false);

  return <section className="gc-panel gc-market-panel" aria-label="腾讯财经行情">
    <div className="gc-section-heading gc-section-heading-row">
      <div><span>03</span><h2>K &amp; Grid</h2></div>
    </div>
    <div className="market-controls">
      <label><span>股票代码</span><input value={stockCode} onChange={(event) => setStockCode(event.target.value)} onKeyUp={(event) => { if (event.key === "Enter") void fetchKlineData(stockCode, kType, count); }} placeholder="300408" /></label>
      <div className="market-period-control">
        <span>周期</span>
        <div className="market-period-tabs" role="group" aria-label="K线周期">
          {PRIMARY_K_TYPES.map((type) => <button key={type} type="button" className={kType === type ? "is-active" : ""} onClick={() => handleKTypeChange(type)}>{PRIMARY_K_TYPE_LABELS[type]}</button>)}
          <select aria-label="更多K线周期" value={EXTRA_K_TYPES.some((item) => item.value === kType) ? kType : ""} onChange={(event) => { if (event.target.value) handleKTypeChange(event.target.value as KType); }}>
            <option value="" disabled>更多</option>
            {EXTRA_K_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="button" className={showGrid ? "is-active market-grid-toggle" : "market-grid-toggle"} onClick={() => setShowGrid((prev) => !prev)} aria-pressed={showGrid}>GRID</button>
          <button type="button" className={showMa ? "is-active market-ma-toggle" : "market-ma-toggle"} onClick={() => setShowMa((prev) => !prev)} aria-pressed={showMa}>MA</button>
          <button type="button" className={showBoll ? "is-active market-boll-toggle" : "market-boll-toggle"} onClick={() => setShowBoll((prev) => !prev)} aria-pressed={showBoll}>BOLL</button>
          <button type="button" className={quietMode ? "is-active market-quiet-toggle" : "market-quiet-toggle"} onClick={() => setQuietMode((prev) => !prev)} aria-pressed={quietMode}>QUIET</button>
        </div>
      </div>
      <label className="market-count-control"><span>显示根数 · {PRIMARY_K_TYPE_LABELS[kType]}</span><div><input aria-label="K线数量" type="number" min={1} max={kType.startsWith("m") ? 320 : 640} value={countDraft} onChange={(event) => setCountDraft(event.target.value)} onBlur={commitCount} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><em>根</em></div></label>
      <button type="button" className="market-refresh-button" aria-label="刷新行情" title="刷新行情" onClick={() => void fetchKlineData(stockCode, kType, count)} disabled={loading}>{loading ? "…" : "↻"}</button>
    </div>
    {error ? <div className="gc-market-error" role="alert">{error}</div> : null}
    {data ? <>
      <div className="market-status-bar-toggle">
        <button type="button" className="market-toggle-btn" onClick={() => setShowStatus((prev) => !prev)}>
          <span>行情参数信息 ({data.stockCode} · {data.kType} · {data.total}条)</span>
          <span>{showStatus ? "收起 ▲" : "展开 ▼"}</span>
        </button>
      </div>
      {showStatus ? (
        <div className="market-status-grid">
          <div><span>状态</span><strong>{data.status}</strong></div><div><span>股票</span><strong>{data.stockCode}</strong></div><div><span>周期</span><strong>{data.kType}</strong></div><div><span>总数</span><strong>{data.total}</strong></div><div><span>获取时间</span><strong>{fetchTimeText(data.fetchTime)}</strong></div><div><span>指标</span><strong>{data.indicators.join(", ")}</strong></div>
        </div>
      ) : null}

      <div className="market-chart-panel">
        <h3>K</h3>
        <KlineChart rows={data.kline} gridParams={gridParams} showGrid={showGrid} showMa={showMa} showBoll={showBoll} quietMode={quietMode} onDataIndex={scrollTableTo} onChartInstance={handleKlineChartInstance} />
      </div>

      <div className="market-chart-panel">
        <h3>Volume &amp; MACD</h3>
        <VolumeMacdChart rows={data.kline} quietMode={quietMode} onDataIndex={scrollTableTo} onChartInstance={handleVolumeMacdChartInstance} />
      </div>

      <div className="market-chart-panel">
        <h3 className="market-panel-heading"><button type="button" className="market-collapsible-header" onClick={() => setShowRsi((prev) => !prev)} aria-expanded={showRsi}>
          <span>RSI</span>
          <span className="market-toggle-badge">{showRsi ? "收起 ▲" : "展开 ▼"}</span>
        </button></h3>
        {showRsi ? <RsiChart rows={data.kline} onDataIndex={scrollTableTo} onChartInstance={handleRsiChartInstance} /> : null}
      </div>

      <div className="market-table-wrap">
        <button type="button" className="market-table-title market-collapsible-header" onClick={() => setShowTable((prev) => !prev)} aria-expanded={showTable}>
          <span>明细（共 {data.kline.length} 条）</span>
          <span className="market-toggle-badge">{showTable ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {showTable ? (
          <div className="market-table-scroll"><table className="market-table" ref={tableRef}><thead><tr><th>Date</th><th>Open</th><th>Close</th><th>High</th><th>Low</th><th>Volume</th><th>MA5</th><th>MA10</th><th>MA20</th><th>MA60</th><th>BOLL-U</th><th>BOLL-M</th><th>BOLL-L</th><th>RSI6</th><th>RSI12</th><th>RSI14</th><th>RSI24</th><th>DIF</th><th>DEA</th><th>MACD</th></tr></thead><tbody>{data.kline.map((row, index) => ({ row, index })).reverse().map(({ row, index }) => <tr data-index={index} key={`${row.date}-${index}`}><td>{row.date}</td><td>{numberText(row.open)}</td><td className={row.close != null && row.open != null && row.close >= row.open ? "market-positive" : "market-negative"}>{numberText(row.close)}</td><td>{numberText(row.high)}</td><td>{numberText(row.low)}</td><td>{volumeText(row.volume)}</td><td>{numberText(row.ma?.ma5)}</td><td>{numberText(row.ma?.ma10)}</td><td>{numberText(row.ma?.ma20)}</td><td>{numberText(row.ma?.ma60)}</td><td>{numberText(row.boll?.upper)}</td><td>{numberText(row.boll?.middle)}</td><td>{numberText(row.boll?.lower)}</td><td>{numberText(row.rsi?.rsi6, 1)}</td><td>{numberText(row.rsi?.rsi12, 1)}</td><td>{numberText(row.rsi?.rsi14, 1)}</td><td>{numberText(row.rsi?.rsi24, 1)}</td><td>{numberText(row.macd?.dif, 3)}</td><td>{numberText(row.macd?.dea, 3)}</td><td>{numberText(row.macd?.histogram, 3)}</td></tr>)}</tbody></table></div>
        ) : null}
      </div>
    </> : <div className="gc-market-empty">输入股票代码后加载腾讯财经行情。</div>}
  </section>;
}

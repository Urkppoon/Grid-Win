"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MarketPanel from "../components/market-panel";
import StrategySidebar, { StrategySidebarItem } from "../components/strategy-sidebar";

import {
  K_TYPES,
  getPriceDecimals,
  roundPriceByCode,
  type KType,
} from "../lib/tencent-technical";

type GridMode = "price" | "ratio";
type BaselineMode = "rolling" | "fixed";

type GridRow = {
  side: "buy" | "sell";
  low: number;
  high: number;
  trigger: number;
  buyAmount: number;
  sellAmount: number;
  grossProfit: number;
  grossRate: number;
  netProfit: number;
  netRate: number;
};

type CalculatorDraft = {
  lower: number | null;
  upper: number | null;
  base: number | null;
  baseSource: string;
  mode: GridMode;
  sellStep: number | null;
  buyStep: number | null;
  lotsPerGrid: number | null;
  roundTripCost: number;
  positionAmount: number | null;
  cash: number | null;
  sellableLots: number | null;
  lockedLots: number | null;
  maxHoldingLots: number | null;
  minHoldingLots: number | null;
  baselineMode: BaselineMode;
  showPositionDetails: boolean;
  showAdvancedSettings: boolean;
  chartPeriod: KType;
};

type GridStrategy = {
  id: string;
  stockCode: string;
  stockName: string;
  name: string;
  status: "running" | "paused";
  draft: CalculatorDraft;
};

const LOT_SIZE = 100;
const EPSILON = 1e-7;
const GRID_DRAFT_STORAGE_KEY = "grid-win:calculator-draft:v1";
const GRID_STRATEGIES_STORAGE_KEY = "grid-win:strategies:v1";
const GRID_SIDEBAR_STORAGE_KEY = "grid-win:sidebar:v1";

const storedNumber = (value: unknown, fallback = Number.NaN) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const storedOptionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const serializableNumber = (value: number) => Number.isFinite(value) ? value : null;

const blankCalculatorDraft = (): CalculatorDraft => ({
  lower: null,
  upper: null,
  base: null,
  baseSource: "manual",
  mode: "price",
  sellStep: null,
  buyStep: null,
  lotsPerGrid: null,
  roundTripCost: 0.2,
  positionAmount: null,
  cash: null,
  sellableLots: null,
  lockedLots: null,
  maxHoldingLots: null,
  minHoldingLots: null,
  baselineMode: "rolling",
  showPositionDetails: false,
  showAdvancedSettings: false,
  chartPeriod: "m15",
});

const calculatorDraftFromRecord = (saved: Record<string, unknown>): CalculatorDraft => ({
  lower: storedOptionalNumber(saved.lower),
  upper: storedOptionalNumber(saved.upper),
  base: storedOptionalNumber(saved.base),
  baseSource: typeof saved.baseSource === "string" ? saved.baseSource : "manual",
  mode: saved.mode === "ratio" ? "ratio" : "price",
  sellStep: storedOptionalNumber(saved.sellStep),
  buyStep: storedOptionalNumber(saved.buyStep),
  lotsPerGrid: storedOptionalNumber(saved.lotsPerGrid),
  roundTripCost: storedNumber(saved.roundTripCost, 0.2),
  positionAmount: storedOptionalNumber(saved.positionAmount),
  cash: storedOptionalNumber(saved.cash),
  sellableLots: storedOptionalNumber(saved.sellableLots),
  lockedLots: storedOptionalNumber(saved.lockedLots),
  maxHoldingLots: storedOptionalNumber(saved.maxHoldingLots),
  minHoldingLots: storedOptionalNumber(saved.minHoldingLots),
  baselineMode: saved.baselineMode === "fixed" ? "fixed" : "rolling",
  showPositionDetails: saved.showPositionDetails === true,
  showAdvancedSettings: saved.showAdvancedSettings === true,
  chartPeriod: (typeof saved.chartPeriod === "string" && K_TYPES.includes(saved.chartPeriod as KType) ? saved.chartPeriod : "m15") as KType,
});

const strategyFromRecord = (value: unknown): GridStrategy | null => {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  if (typeof saved.id !== "string" || typeof saved.name !== "string") return null;
  return {
    id: saved.id,
    stockCode: typeof saved.stockCode === "string" ? saved.stockCode : "300408",
    stockName: typeof saved.stockName === "string" ? saved.stockName : "三环集团",
    name: saved.name,
    status: saved.status === "paused" ? "paused" : "running",
    draft: saved.draft && typeof saved.draft === "object"
      ? calculatorDraftFromRecord(saved.draft as Record<string, unknown>)
      : blankCalculatorDraft(),
  };
};

const roundPrice = (value: number, code: string) =>
  roundPriceByCode(value, code);

const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const priceMoney = (value: number, code: string) => {
  const decimals = getPriceDecimals(code);
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

const integer = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);

const percent = (value: number) => `${value.toFixed(3)}%`;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="gc-field">
      <span className="gc-label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function NumericInput({
  value,
  onValueChange,
  min,
  step,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : "");
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "") {
      onValueChange(Number.NaN);
      return;
    }
    if (!Number.isFinite(parsed)) {
      onValueChange(Number.NaN);
      return;
    }
    onValueChange(parsed);
  };
  return <input type="number" min={min} step={step} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }} />;
}

function OptionalNumericInput({ value, onValueChange, min = 0, step = 1, placeholder }: { value: number | null; onValueChange: (value: number | null) => void; min?: number; step?: number; placeholder: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const commit = () => {
    if (draft.trim() === "") { onValueChange(null); return; }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < min) { setDraft(value == null ? "" : String(value)); return; }
    onValueChange(parsed);
  };
  return <input type="number" min={min} step={step} placeholder={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

export default function CalculatorPage() {
  const [lower, setLower] = useState<number>(Number.NaN);
  const [upper, setUpper] = useState<number>(Number.NaN);
  const [base, setBase] = useState<number>(Number.NaN);
  const [baseSource, setBaseSource] = useState("manual");
  const [mode, setMode] = useState<GridMode>("price");
  const [sellStep, setSellStep] = useState<number>(Number.NaN);
  const [buyStep, setBuyStep] = useState<number>(Number.NaN);
  const [lotsPerGrid, setLotsPerGrid] = useState<number>(Number.NaN);
  const [roundTripCost, setRoundTripCost] = useState<number>(0.2);
  const [positionAmount, setPositionAmount] = useState<number | null>(null);
  const [cash, setCash] = useState<number>(Number.NaN);
  const [sellableLots, setSellableLots] = useState<number>(Number.NaN);
  const [lockedLots, setLockedLots] = useState<number>(Number.NaN);
  const [maxHoldingLots, setMaxHoldingLots] = useState<number | null>(null);
  const [minHoldingLots, setMinHoldingLots] = useState<number | null>(null);
  const [baselineMode, setBaselineMode] = useState<BaselineMode>("rolling");
  const [showPositionDetails, setShowPositionDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [chartPeriod, setChartPeriod] = useState<KType>("m15");
  const [draftReady, setDraftReady] = useState(false);
  const [strategies, setStrategies] = useState<GridStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [marketResetSignal, setMarketResetSignal] = useState(0);
  const totalLots = sellableLots + lockedLots;

  const applyCalculatorDraft = useCallback((draft: CalculatorDraft) => {
    setLower(draft.lower ?? Number.NaN);
    setUpper(draft.upper ?? Number.NaN);
    setBase(draft.base ?? Number.NaN);
    setBaseSource(draft.baseSource);
    setMode(draft.mode);
    setSellStep(draft.sellStep ?? Number.NaN);
    setBuyStep(draft.buyStep ?? Number.NaN);
    setLotsPerGrid(draft.lotsPerGrid ?? Number.NaN);
    setRoundTripCost(draft.roundTripCost);
    setPositionAmount(draft.positionAmount);
    setCash(draft.cash ?? Number.NaN);
    setSellableLots(draft.sellableLots ?? Number.NaN);
    setLockedLots(draft.lockedLots ?? Number.NaN);
    setMaxHoldingLots(draft.maxHoldingLots);
    setMinHoldingLots(draft.minHoldingLots);
    setBaselineMode(draft.baselineMode);
    setShowPositionDetails(draft.showPositionDetails);
    setShowAdvancedSettings(draft.showAdvancedSettings);
    setChartPeriod(draft.chartPeriod ?? "m15");
  }, []);

  const currentDraft = useMemo<CalculatorDraft>(() => ({
    lower: serializableNumber(lower),
    upper: serializableNumber(upper),
    base: serializableNumber(base),
    baseSource,
    mode,
    sellStep: serializableNumber(sellStep),
    buyStep: serializableNumber(buyStep),
    lotsPerGrid: serializableNumber(lotsPerGrid),
    roundTripCost: Number.isFinite(roundTripCost) ? roundTripCost : 0.2,
    positionAmount: positionAmount != null && Number.isFinite(positionAmount) ? positionAmount : null,
    cash: serializableNumber(cash),
    sellableLots: serializableNumber(sellableLots),
    lockedLots: serializableNumber(lockedLots),
    maxHoldingLots,
    minHoldingLots,
    baselineMode,
    showPositionDetails,
    showAdvancedSettings,
    chartPeriod,
  }), [base, baseSource, baselineMode, buyStep, cash, chartPeriod, lockedLots, lotsPerGrid, lower, maxHoldingLots, minHoldingLots, mode, positionAmount, roundTripCost, sellStep, sellableLots, showAdvancedSettings, showPositionDetails, upper]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let migratedDraft = blankCalculatorDraft();
      try {
        const raw = window.localStorage.getItem(GRID_DRAFT_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, unknown>;
          migratedDraft = calculatorDraftFromRecord(saved);
        }
      } catch {
        window.localStorage.removeItem(GRID_DRAFT_STORAGE_KEY);
      }

      let restoredStrategies: GridStrategy[] = [];
      let restoredSelectedId = "";
      try {
        const raw = window.localStorage.getItem(GRID_STRATEGIES_STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, unknown>;
          restoredStrategies = Array.isArray(saved.strategies)
            ? saved.strategies.map(strategyFromRecord).filter((strategy): strategy is GridStrategy => strategy !== null)
            : [];
          restoredSelectedId = typeof saved.selectedStrategyId === "string" ? saved.selectedStrategyId : "";
        }
      } catch {
        window.localStorage.removeItem(GRID_STRATEGIES_STORAGE_KEY);
      }

      if (restoredStrategies.length === 0) {
        const defaultStrategy: GridStrategy = {
          id: "strategy-default-300408",
          stockCode: "300408",
          stockName: "三环集团",
          name: "默认网格",
          status: "running",
          draft: migratedDraft,
        };
        restoredStrategies = [defaultStrategy];
        restoredSelectedId = defaultStrategy.id;
      }

      const selected = restoredStrategies.find((strategy) => strategy.id === restoredSelectedId) ?? restoredStrategies[0];
      setStrategies(restoredStrategies);
      setSelectedStrategyId(selected.id);
      applyCalculatorDraft(selected.draft);
      setSidebarCollapsed(window.localStorage.getItem(GRID_SIDEBAR_STORAGE_KEY) === "collapsed");
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyCalculatorDraft]);

  useEffect(() => {
    if (!draftReady) return;
    window.localStorage.setItem(GRID_DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), ...currentDraft }));
    if (!selectedStrategyId) return;
    const timer = window.setTimeout(() => {
      setStrategies((previous) => previous.map((strategy) =>
        strategy.id === selectedStrategyId ? { ...strategy, draft: currentDraft } : strategy
      ));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentDraft, draftReady, selectedStrategyId]);

  useEffect(() => {
    if (!draftReady || strategies.length === 0) return;
    window.localStorage.setItem(GRID_STRATEGIES_STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      selectedStrategyId,
      strategies,
    }));
  }, [draftReady, selectedStrategyId, strategies]);

  useEffect(() => {
    if (!draftReady) return;
    window.localStorage.setItem(GRID_SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "collapsed" : "expanded");
    const timer = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 260);
    return () => window.clearTimeout(timer);
  }, [draftReady, sidebarCollapsed]);

  const clearDraft = () => {
    window.localStorage.removeItem(GRID_DRAFT_STORAGE_KEY);
    setLower(Number.NaN);
    setUpper(Number.NaN);
    setBase(Number.NaN);
    setBaseSource("manual");
    setMode("price");
    setSellStep(Number.NaN);
    setBuyStep(Number.NaN);
    setLotsPerGrid(Number.NaN);
    setRoundTripCost(0.2);
    setPositionAmount(null);
    setCash(Number.NaN);
    setSellableLots(Number.NaN);
    setLockedLots(Number.NaN);
    setMaxHoldingLots(null);
    setMinHoldingLots(null);
    setBaselineMode("rolling");
    setShowPositionDetails(false);
    setShowAdvancedSettings(false);
    setChartPeriod("m15");
    setMarketResetSignal((value) => value + 1);
  };

  const selectStrategy = (id: string) => {
    if (id === selectedStrategyId) return;
    const target = strategies.find((strategy) => strategy.id === id);
    if (!target) return;
    setStrategies((previous) => previous.map((strategy) =>
      strategy.id === selectedStrategyId ? { ...strategy, draft: currentDraft } : strategy
    ));
    setSelectedStrategyId(id);
    applyCalculatorDraft(target.draft);
  };

  const createStrategy = ({ stockCode, stockName, name }: { stockCode: string; stockName: string; name: string }) => {
    const next: GridStrategy = {
      id: `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stockCode,
      stockName,
      name,
      status: "running",
      draft: blankCalculatorDraft(),
    };
    setStrategies((previous) => [
      ...previous.map((strategy) => strategy.id === selectedStrategyId ? { ...strategy, draft: currentDraft } : strategy),
      next,
    ]);
    setSelectedStrategyId(next.id);
    applyCalculatorDraft(next.draft);
  };

  const toggleStrategyStatus = (id: string) => {
    setStrategies((previous) => previous.map((strategy) =>
      strategy.id === id
        ? { ...strategy, status: strategy.status === "running" ? "paused" : "running" }
        : strategy
    ));
  };

  const updateStrategyInfo = (id: string, updates: { name: string; stockCode: string; stockName: string }) => {
    const nextName = updates.name.trim();
    if (!nextName) return;
    setStrategies((previous) => previous.map((strategy) =>
      strategy.id === id
        ? {
            ...strategy,
            name: nextName,
            stockCode: updates.stockCode.trim() || strategy.stockCode,
            stockName: updates.stockName.trim() || strategy.stockName,
          }
        : strategy
    ));
  };

  const deleteStrategy = (id: string) => {
    if (strategies.length <= 1) {
      alert("至少需要保留一套网格策略，无法删除唯一策略。");
      return;
    }
    const remaining = strategies.filter((strategy) => strategy.id !== id);
    setStrategies(remaining);
    if (selectedStrategyId === id) {
      const nextStrategy = remaining[0];
      setSelectedStrategyId(nextStrategy.id);
      applyCalculatorDraft(nextStrategy.draft);
    }
  };

  const updateSelectedStockCode = (stockCode: string) => {
    setStrategies((previous) => previous.map((strategy) =>
      strategy.id === selectedStrategyId ? { ...strategy, stockCode } : strategy
    ));
  };

  const activeStrategy = strategies.find((strategy) => strategy.id === selectedStrategyId) ?? strategies[0];
  const isETF = getPriceDecimals(activeStrategy?.stockCode ?? "") === 3;
  const sidebarStrategies = useMemo<StrategySidebarItem[]>(() => strategies.map((strategy) => ({
    id: strategy.id,
    stockCode: strategy.stockCode,
    stockName: strategy.stockName,
    name: strategy.name,
    status: strategy.status,
    cash: strategy.id === selectedStrategyId ? (positionAmount ?? serializableNumber(cash)) : (strategy.draft.positionAmount ?? strategy.draft.cash),
    lower: strategy.id === selectedStrategyId ? serializableNumber(lower) : strategy.draft.lower,
    upper: strategy.id === selectedStrategyId ? serializableNumber(upper) : strategy.draft.upper,
  })), [cash, lower, positionAmount, selectedStrategyId, strategies, upper]);

  const result = useMemo(() => {
    const values = [
      lower,
      upper,
      base,
      sellStep,
      buyStep,
      lotsPerGrid,
      roundTripCost,
      cash,
      sellableLots,
      lockedLots,
    ];

    if (!values.every(Number.isFinite)) {
      return { error: "请填写有效数字。" } as const;
    }
    if (lower <= 0 || upper <= lower) {
      return { error: "价格下限必须大于0，并且上限必须高于下限。" } as const;
    }
    if (base < lower || base > upper) {
      return { error: "初始基准价必须位于价格区间内。" } as const;
    }
    if (sellStep <= 0 || buyStep <= 0) {
      return { error: mode === "price" ? "买卖价差必须大于0。" : "买卖比例必须大于0。" } as const;
    }
    if (mode === "ratio" && (sellStep >= 100 || buyStep >= 100)) {
      return { error: "比例必须大于0且小于100%。" } as const;
    }
    if (!Number.isInteger(lotsPerGrid) || lotsPerGrid < 1) {
      return { error: "每格手数必须是至少1手的整数。" } as const;
    }
    if (roundTripCost < 0 || cash < 0 || sellableLots < 0 || lockedLots < 0) {
      return { error: "资金、持仓和成本率不能为负数。" } as const;
    }
    if ((minHoldingLots != null && !Number.isInteger(minHoldingLots)) || (maxHoldingLots != null && !Number.isInteger(maxHoldingLots))) {
      return { error: "持仓上下限必须为整数手数。" } as const;
    }
    if (minHoldingLots != null && minHoldingLots < 0 || maxHoldingLots != null && maxHoldingLots < 0) {
      return { error: "持仓上下限不能为负数。" } as const;
    }
    if (minHoldingLots != null && maxHoldingLots != null && minHoldingLots > maxHoldingLots) {
      return { error: "最小持仓不能高于最大持仓。" } as const;
    }

    const down: number[] = [];
    const up: number[] = [];
    const seenDown = new Set<number>();
    const seenUp = new Set<number>();

    const currentCode = activeStrategy?.stockCode ?? "300408";
    let currentDown = roundPrice(base, currentCode);
    for (let index = 1; index <= 200; index += 1) {
      const nextRaw =
        mode === "price"
          ? currentDown - buyStep
          : currentDown * (1 - buyStep / 100);
      const price = roundPrice(nextRaw, currentCode);
      if (price < lower - EPSILON) break;
      if (price >= currentDown || seenDown.has(price)) break;
      seenDown.add(price);
      down.push(price);
      currentDown = price;
    }

    let currentUp = roundPrice(base, currentCode);
    for (let index = 1; index <= 200; index += 1) {
      const nextRaw =
        mode === "price"
          ? currentUp + sellStep
          : currentUp * (1 + sellStep / 100);
      const price = roundPrice(nextRaw, currentCode);
      if (price > upper + EPSILON) break;
      if (price <= currentUp || seenUp.has(price)) break;
      seenUp.add(price);
      up.push(price);
      currentUp = price;
    }

    const levels = [...down].reverse().concat(roundPrice(base, currentCode), up);
    const quantity = lotsPerGrid * LOT_SIZE;
    const rows: GridRow[] = [];

    for (let index = 0; index < levels.length - 1; index += 1) {
      const low = levels[index];
      const high = levels[index + 1];
      const side: GridRow["side"] = high <= base + EPSILON ? "buy" : "sell";
      const grossProfit = (high - low) * quantity;
      const grossRate = ((high / low) - 1) * 100;
      const estimatedCost = low * quantity * (roundTripCost / 100);
      const netProfit = grossProfit - estimatedCost;
      const netRate = grossRate - roundTripCost;

      rows.push({
        side,
        low,
        high,
        trigger: side === "buy" ? low : high,
        buyAmount: low * quantity,
        sellAmount: high * quantity,
        grossProfit,
        grossRate,
        netProfit,
        netRate,
      });
    }

    const buyRows = rows
      .filter((row) => row.side === "buy")
      .sort((a, b) => b.trigger - a.trigger);
    const sellRows = rows
      .filter((row) => row.side === "sell")
      .sort((a, b) => a.trigger - b.trigger);

    let cashLeft = cash;
    let affordableBuyGrids = 0;
    const maxAdditionalLots = maxHoldingLots == null ? Number.POSITIVE_INFINITY : Math.max(0, maxHoldingLots - totalLots);
    const positionBuyCapacity = Number.isFinite(maxAdditionalLots) ? Math.floor(maxAdditionalLots / lotsPerGrid) : Number.POSITIVE_INFINITY;
    for (const row of buyRows) {
      if (cashLeft + EPSILON < row.buyAmount || affordableBuyGrids >= positionBuyCapacity) break;
      cashLeft -= row.buyAmount;
      affordableBuyGrids += 1;
    }

    const sellableAboveFloor = Math.max(0, totalLots - (minHoldingLots ?? 0));
    const sellCapacity = Math.min(Math.floor(sellableLots / lotsPerGrid), Math.floor(sellableAboveFloor / lotsPerGrid));
    const executableSellGrids = Math.min(sellRows.length, sellCapacity);
    const requiredDownCash = buyRows.reduce((sum, row) => sum + row.buyAmount, 0);
    const requiredSellableLots = sellRows.length * lotsPerGrid;
    const lowestLevel = levels[0] ?? base;
    const highestLevel = levels.at(-1) ?? base;
    const lowerRemainder = Math.max(0, lowestLevel - lower);
    const upperRemainder = Math.max(0, upper - highestLevel);

    return {
      error: "",
      levels,
      rows,
      buyRows,
      sellRows,
      quantity,
      requiredDownCash,
      requiredSellableLots,
      affordableBuyGrids,
      executableSellGrids,
      cashLeft,
      lowerRemainder,
      upperRemainder,
      firstMissedBuy: buyRows[affordableBuyGrids],
      firstMissedSell: sellRows[executableSellGrids],
      positionBuyCapacity,
      sellCapacity,
    } as const;
  }, [
    lower,
    upper,
    base,
    sellStep,
    buyStep,
    lotsPerGrid,
    roundTripCost,
    cash,
    sellableLots,
    lockedLots,
    maxHoldingLots,
    minHoldingLots,
    totalLots,
    mode,
  ]);

  const hasError = Boolean(result.error);
  const valid = hasError ? null : result;
  return (
    <div className="gc-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <StrategySidebar
        collapsed={sidebarCollapsed}
        strategies={sidebarStrategies}
        selectedId={selectedStrategyId}
        onToggle={() => setSidebarCollapsed((previous) => !previous)}
        onSelect={selectStrategy}
        onCreate={createStrategy}
        onRename={updateStrategyInfo}
        onToggleStatus={toggleStrategyStatus}
        onDelete={deleteStrategy}
      />

      <main className="gc-app">
        <h1>grid win</h1>
        <p className="gc-visually-hidden">支持单边行情承受力测算，并区分昨日可卖底仓与今日买入锁定持仓。</p>
        <header className="gc-context-bar">
          <div>
            <span>{activeStrategy?.stockCode || "未设置代码"} {activeStrategy?.stockName || "未命名个股"}</span>
            <i aria-hidden="true" />
            <strong>{activeStrategy?.name || "默认网格"}</strong>
          </div>
          <span className="gc-save-state"><i aria-hidden="true" />已自动保存</span>
        </header>

        <section className="gc-layout">
        <aside className="gc-panel gc-controls" aria-label="网格参数">
          <div className="gc-section-heading gc-section-heading-row">
            <div>
              <span>01</span>
              <h2>触发条件</h2>
            </div>
            <button type="button" className="gc-clear-button" onClick={clearDraft}>一键清空</button>
          </div>

          <div className="gc-fields gc-fields-three">
            <Field label="价格下限（元）">
              <NumericInput key={`lower-${marketResetSignal}-${lower}`} min={isETF ? 0.001 : 0.01} step={isETF ? 0.001 : 0.01} value={lower} onValueChange={setLower} />
            </Field>
            <Field label="初始基准价（元）">
              <NumericInput key={`base-${marketResetSignal}-${base}`} min={isETF ? 0.001 : 0.01} step={isETF ? 0.001 : 0.01} value={base} onValueChange={setBase} />
            </Field>
            <Field label="价格上限（元）">
              <NumericInput key={`upper-${marketResetSignal}-${upper}`} min={isETF ? 0.001 : 0.01} step={isETF ? 0.001 : 0.01} value={upper} onValueChange={setUpper} />
            </Field>
          </div>

          <div className="gc-fields gc-fields-two">
            <Field label="基准价来源" hint="当前不接行情，仅记录选取口径">
              <select value={baseSource} onChange={(event) => setBaseSource(event.target.value)}>
                <option value="manual">手动输入</option>
                <option value="latest">最新价</option>
                <option value="cost">持仓成本价</option>
                <option value="close">昨收价</option>
                <option value="open">开盘价</option>
              </select>
            </Field>
            <Field label="成交后基准">
              <select value={baselineMode} onChange={(event) => setBaselineMode(event.target.value as BaselineMode)}>
                <option value="rolling">滚动到成交价</option>
                <option value="fixed">保持初始基准</option>
              </select>
            </Field>
          </div>

          <div className="gc-segmented" role="group" aria-label="涨跌类型">
            <button type="button" data-active={mode === "price"} onClick={() => setMode("price")}>按价格</button>
            <button type="button" data-active={mode === "ratio"} onClick={() => setMode("ratio")}>按比例</button>
          </div>

          <div className="gc-fields gc-fields-two">
            <Field label={`上涨 - 卖出（${mode === "price" ? "元" : "%"}）`}>
              <NumericInput key={`sell-step-${marketResetSignal}-${sellStep}`} min={mode === "price" && isETF ? 0.001 : 0.01} step={mode === "price" && isETF ? 0.001 : 0.01} value={sellStep} onValueChange={setSellStep} />
            </Field>
            <Field label={`下跌 - 买入（${mode === "price" ? "元" : "%"}）`}>
              <NumericInput key={`buy-step-${marketResetSignal}-${buyStep}`} min={mode === "price" && isETF ? 0.001 : 0.01} step={mode === "price" && isETF ? 0.001 : 0.01} value={buyStep} onValueChange={setBuyStep} />
            </Field>
          </div>

          <div className="gc-divider" />

          <div className="gc-section-heading">
            <div>
              <span>02</span>
              <h2>持仓管理</h2>
            </div>
          </div>

          <div className="gc-fields gc-fields-two">
            <Field label="每格交易（手）">
              <NumericInput key={`lots-${marketResetSignal}-${lotsPerGrid}`} min={1} step={1} value={lotsPerGrid} onValueChange={setLotsPerGrid} />
            </Field>
            <Field label="可用现金（元）">
              <NumericInput key={`cash-${marketResetSignal}-${cash}`} min={0} step={100} value={cash} onValueChange={setCash} />
            </Field>
            <Field label="最大持仓（手）" hint="达到上限后不再触发买入">
              <OptionalNumericInput key={`max-holding-${marketResetSignal}-${maxHoldingLots}`} min={0} step={1} value={maxHoldingLots} onValueChange={setMaxHoldingLots} placeholder="不设上限" />
            </Field>
            <Field label="最小持仓（手）" hint="触及下限后不再触发卖出">
              <OptionalNumericInput key={`min-holding-${marketResetSignal}-${minHoldingLots}`} min={0} step={1} value={minHoldingLots} onValueChange={setMinHoldingLots} placeholder="不设下限" />
            </Field>
          </div>

          <button type="button" className="gc-inline-toggle" onClick={() => setShowPositionDetails((prev) => !prev)} aria-expanded={showPositionDetails}>
            <span>持仓明细</span><span className="gc-inline-toggle-badge">{showPositionDetails ? "收起 ▲" : "展开 ▼"}</span>
          </button>
          {showPositionDetails ? <div className="gc-fields gc-fields-two gc-revealed-fields">
            <Field label="昨日可卖底仓（手）">
              <NumericInput key={`sellable-${marketResetSignal}-${sellableLots}`} min={0} step={1} value={sellableLots} onValueChange={setSellableLots} />
            </Field>
            <Field label="今日买入锁定（手）">
              <NumericInput key={`locked-${marketResetSignal}-${lockedLots}`} min={0} step={1} value={lockedLots} onValueChange={setLockedLots} />
            </Field>
          </div> : null}

          <div className="gc-position-card">
            <div>
              <span>当前总持仓</span>
              <small style={{ marginLeft: '8px' }}>
                {Number.isFinite(sellableLots) ? `(其中可卖 ${integer(sellableLots)} 手)` : ""}
              </small>
            </div>
            <strong>{Number.isFinite(totalLots) ? `${integer(totalLots)}手` : "—"}</strong>
          </div>

          <button type="button" className="gc-inline-toggle" onClick={() => setShowAdvancedSettings((prev) => !prev)} aria-expanded={showAdvancedSettings}>
            <span>交易成本</span><span className="gc-inline-toggle-badge">{showAdvancedSettings ? "收起 ▲" : "展开 ▼"}</span>
          </button>
          {showAdvancedSettings ? <div className="gc-fields gc-fields-two gc-revealed-fields">
            <Field label="估算往返成本率（%）">
              <NumericInput key={`cost-${marketResetSignal}-${roundTripCost}`} min={0} step={0.01} value={roundTripCost} onValueChange={setRoundTripCost} />
            </Field>
            <Field label="持仓金额（元）">
              <OptionalNumericInput key={`posAmount-${marketResetSignal}-${positionAmount}`} min={0} step={100} value={positionAmount} onValueChange={setPositionAmount} placeholder="待填写" />
            </Field>
          </div> : null}

          {hasError ? <div className="gc-error" role="alert">{result.error}</div> : null}
        </aside>

        <section className="gc-results" aria-live="polite">
          <MarketPanel
            gridParams={{ lowerLimit: lower, basePrice: base, upperLimit: upper, buyStep, sellStep, mode }}
            resetSignal={marketResetSignal}
            strategyStockCode={activeStrategy?.stockCode ?? ""}
            onStockCodeChange={updateSelectedStockCode}
            selectedKType={chartPeriod}
            onKTypeChange={setChartPeriod}
          />

          {valid ? (
            <>
              <div className="gc-panel gc-capacity">
                <div className="gc-section-heading gc-section-heading-row">
                  <div>
                    <span>04</span>
                    <h2>行情推演</h2>
                  </div>
                </div>

                <section className="gc-strategy-overview" aria-label="策略概览">
                  <span className="gc-overview-label">策略概览</span>
                  <div className="gc-summary-grid">
                    <article>
                      <span>完整网格</span>
                      <strong>{valid.rows.length}</strong>
                      <small>{valid.levels.length} 条价格线</small>
                    </article>
                    <article>
                      <span>下跌买入</span>
                      <strong>{valid.buyRows.length}格</strong>
                      <small>资金可覆盖 {valid.affordableBuyGrids} 格</small>
                    </article>
                    <article>
                      <span>上涨卖出</span>
                      <strong>{valid.sellRows.length}格</strong>
                      <small>底仓可覆盖 {valid.executableSellGrids} 格</small>
                    </article>
                    <article>
                      <span>每格数量</span>
                      <strong>{integer(valid.quantity)}股</strong>
                      <small>{lotsPerGrid}手 × 100股</small>
                    </article>
                  </div>
                </section>

                <div className="gc-capacity-grid">
                  <div className="gc-capacity-item" data-side="buy" data-safe={valid.affordableBuyGrids >= valid.buyRows.length}>
                    <div className="gc-capacity-title">
                      <span>连续下跌</span>
                      <strong>{valid.affordableBuyGrids}/{valid.buyRows.length}格</strong>
                    </div>
                    <div className="gc-meter"><i style={{ width: `${valid.buyRows.length ? Math.min(100, valid.affordableBuyGrids / valid.buyRows.length * 100) : 100}%` }} /></div>
                    <p>覆盖全部下方买单需 {money(valid.requiredDownCash)} 元。</p>
                    {valid.firstMissedBuy ? <b>{valid.affordableBuyGrids === valid.positionBuyCapacity ? "最大持仓将在下一格买入前触及上限。" : `资金将在触及 ${priceMoney(valid.firstMissedBuy.trigger, activeStrategy?.stockCode ?? "300408")} 元前不足。`}</b> : <b>当前现金和持仓上限可以覆盖全部下方网格。</b>}
                  </div>

                  <div className="gc-capacity-item" data-side="sell" data-safe={valid.executableSellGrids >= valid.sellRows.length}>
                    <div className="gc-capacity-title">
                      <span>连续上涨</span>
                      <strong>{valid.executableSellGrids}/{valid.sellRows.length}格</strong>
                    </div>
                    <div className="gc-meter"><i style={{ width: `${valid.sellRows.length ? Math.min(100, valid.executableSellGrids / valid.sellRows.length * 100) : 100}%` }} /></div>
                    <p>覆盖全部上方卖单需 {valid.requiredSellableLots} 手昨日可卖底仓。</p>
                    {valid.firstMissedSell ? <b>{valid.executableSellGrids === valid.sellCapacity ? "最小持仓将在下一格卖出前触及下限。" : `底仓将在触及 ${priceMoney(valid.firstMissedSell.trigger, activeStrategy?.stockCode ?? "300408")} 元前耗尽，继续上涨可能踏空。`}</b> : <b>当前底仓和最小持仓限制可以覆盖全部上方网格。</b>}
                  </div>
                </div>

                {lockedLots > 0 ? (
                  <div className="gc-t1-note">
                    <strong>T+1提醒</strong>
                    今日买入的 {lockedLots} 手已锁定；即使盘中反弹，也不能补充今天的卖出额度。
                  </div>
                ) : null}
              </div>

              <div className="gc-panel gc-ladder-panel">
                <div className="gc-section-heading gc-section-heading-row">
                  <div>
                    <span>05</span>
                    <h2>价格层与买卖区域</h2>
                  </div>
                </div>

                <div className="gc-ladder-scroll">
                  <div className="gc-ladder">
                    {[...valid.levels].reverse().map((price) => {
                      const zone = Math.abs(price - base) < EPSILON ? "base" : price > base ? "sell" : "buy";
                      return (
                        <div className="gc-level" data-zone={zone} key={price}>
                          <span>{zone === "base" ? "初始基准" : zone === "sell" ? "上涨卖出" : "下跌买入"}</span>
                          <strong>{priceMoney(price, activeStrategy?.stockCode ?? "300408")}</strong>
                          <small>{zone === "base" ? "等待相邻格触发" : `${lotsPerGrid}手`}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(valid.lowerRemainder > EPSILON || valid.upperRemainder > EPSILON) ? (
                  <div className="gc-remainder">
                    <strong>边界余量未组成完整网格</strong>
                    <span>
                      下限侧 {priceMoney(valid.lowerRemainder, activeStrategy?.stockCode ?? "300408")} 元 · 上限侧 {priceMoney(valid.upperRemainder, activeStrategy?.stockCode ?? "300408")} 元
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="gc-panel gc-table-panel">
                <div className="gc-section-heading gc-section-heading-row">
                  <div>
                    <span>06</span>
                    <h2>收益预估</h2>
                  </div>
                </div>

                <div className="gc-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>初始触发</th>
                        <th>买入 → 卖出</th>
                        <th>买入金额</th>
                        <th>卖出金额</th>
                        <th>毛利润</th>
                        <th>毛收益率</th>
                        <th>估算净利润</th>
                        <th>估算净收益率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...valid.rows].reverse().map((row) => (
                        <tr key={`${row.low}-${row.high}`}>
                          <td><span className={`gc-action gc-action-${row.side}`}>{row.side === "buy" ? "下跌买入" : "上涨卖出"}</span></td>
                          <td>{priceMoney(row.low, activeStrategy?.stockCode ?? "300408")} → {priceMoney(row.high, activeStrategy?.stockCode ?? "300408")}</td>
                          <td>{money(row.buyAmount)}</td>
                          <td>{money(row.sellAmount)}</td>
                          <td>{money(row.grossProfit)}</td>
                          <td>{percent(row.grossRate)}</td>
                          <td className={row.netProfit < 0 ? "gc-negative" : ""}>{money(row.netProfit)}</td>
                          <td className={row.netRate < 0 ? "gc-negative" : ""}>{percent(row.netRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </>
          ) : (
            <div className="gc-empty">修正左侧参数后，这里会生成完整的网格与承受力测算。</div>
          )}
        </section>
        </section>
      </main>
    </div>
  );
}

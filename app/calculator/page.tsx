"use client";

import { useMemo, useState } from "react";
import MarketPanel from "../components/market-panel";

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

const LOT_SIZE = 100;
const EPSILON = 1e-7;

const roundPrice = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const money = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

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
  const [cash, setCash] = useState<number>(Number.NaN);
  const [sellableLots, setSellableLots] = useState<number>(Number.NaN);
  const [lockedLots, setLockedLots] = useState<number>(Number.NaN);
  const [maxHoldingLots, setMaxHoldingLots] = useState<number | null>(null);
  const [minHoldingLots, setMinHoldingLots] = useState<number | null>(null);
  const [baselineMode, setBaselineMode] = useState<BaselineMode>("rolling");
  const [showPositionDetails, setShowPositionDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const totalLots = sellableLots + lockedLots;

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

    for (let index = 1; index <= 200; index += 1) {
      const raw =
        mode === "price"
          ? base - buyStep * index
          : base * Math.pow(1 - buyStep / 100, index);
      const price = roundPrice(raw);
      if (price < lower - EPSILON) break;
      if (price >= base || seenDown.has(price)) continue;
      seenDown.add(price);
      down.push(price);
    }

    for (let index = 1; index <= 200; index += 1) {
      const raw =
        mode === "price"
          ? base + sellStep * index
          : base * Math.pow(1 + sellStep / 100, index);
      const price = roundPrice(raw);
      if (price > upper + EPSILON) break;
      if (price <= base || seenUp.has(price)) continue;
      seenUp.add(price);
      up.push(price);
    }

    const levels = [...down].reverse().concat(roundPrice(base), up);
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
    <main className="gc-app">
      <header className="gc-hero">
        <div>
          <span className="gc-eyebrow">A股 T+1 网格设计</span>
          <h1>Grid Win</h1>
        </div>
      </header>

      <section className="gc-layout">
        <aside className="gc-panel gc-controls" aria-label="网格参数">
          <div className="gc-section-heading">
            <div>
              <span>01</span>
              <h2>触发条件</h2>
            </div>
          </div>

          <div className="gc-fields gc-fields-three">
            <Field label="价格下限（元）">
              <NumericInput min={0.01} step={0.01} value={lower} onValueChange={setLower} />
            </Field>
            <Field label="初始基准价（元）">
              <NumericInput min={0.01} step={0.01} value={base} onValueChange={setBase} />
            </Field>
            <Field label="价格上限（元）">
              <NumericInput min={0.01} step={0.01} value={upper} onValueChange={setUpper} />
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
            <Field label={`上涨卖出${mode === "price" ? "价差（元）" : "比例（%）"}`}>
              <NumericInput min={0.01} step={0.01} value={sellStep} onValueChange={setSellStep} />
            </Field>
            <Field label={`下跌买入${mode === "price" ? "价差（元）" : "比例（%）"}`}>
              <NumericInput min={0.01} step={0.01} value={buyStep} onValueChange={setBuyStep} />
            </Field>
          </div>

          <div className="gc-divider" />

          <div className="gc-section-heading">
            <div>
              <span>02</span>
              <h2>持仓管理</h2>
            </div>
            <p>1手按100股计算；持仓上下限留空则不限制。</p>
          </div>

          <div className="gc-fields gc-fields-two">
            <Field label="每格交易（手）">
              <NumericInput min={1} step={1} value={lotsPerGrid} onValueChange={setLotsPerGrid} />
            </Field>
            <Field label="可用现金（元）">
              <NumericInput min={0} step={100} value={cash} onValueChange={setCash} />
            </Field>
            <Field label="最大持仓（手）" hint="达到上限后不再触发买入">
              <OptionalNumericInput min={0} step={1} value={maxHoldingLots} onValueChange={setMaxHoldingLots} placeholder="不设上限" />
            </Field>
            <Field label="最小持仓（手）" hint="触及下限后不再触发卖出">
              <OptionalNumericInput min={0} step={1} value={minHoldingLots} onValueChange={setMinHoldingLots} placeholder="不设下限" />
            </Field>
            <div className="gc-position-card">
              <span>当前总持仓</span>
              <strong>{Number.isFinite(totalLots) ? `${integer(totalLots)}手` : "—"}</strong>
              <small>{Number.isFinite(sellableLots) ? `其中可卖 ${integer(sellableLots)} 手` : "填写 T+1 持仓后显示可卖数量"}</small>
            </div>
          </div>

          <button type="button" className="gc-inline-toggle" onClick={() => setShowPositionDetails((prev) => !prev)} aria-expanded={showPositionDetails}>
            <span>T+1 持仓明细</span><span className="gc-inline-toggle-badge">{showPositionDetails ? "收起 ▲" : "展开 ▼"}</span>
          </button>
          {showPositionDetails ? <div className="gc-fields gc-fields-two gc-revealed-fields">
            <Field label="昨日可卖底仓（手）">
              <NumericInput min={0} step={1} value={sellableLots} onValueChange={setSellableLots} />
            </Field>
            <Field label="今日买入锁定（手）" hint="仅计入总持仓，不增加今日卖出能力">
              <NumericInput min={0} step={1} value={lockedLots} onValueChange={setLockedLots} />
            </Field>
          </div> : null}

          <button type="button" className="gc-inline-toggle" onClick={() => setShowAdvancedSettings((prev) => !prev)} aria-expanded={showAdvancedSettings}>
            <span>交易成本设置</span><span className="gc-inline-toggle-badge">{showAdvancedSettings ? "收起 ▲" : "展开 ▼"}</span>
          </button>
          {showAdvancedSettings ? <div className="gc-fields gc-revealed-fields">
            <Field label="估算往返成本率（%）">
              <NumericInput min={0} step={0.01} value={roundTripCost} onValueChange={setRoundTripCost} />
            </Field>
          </div> : null}

          {hasError ? <div className="gc-error" role="alert">{result.error}</div> : null}
        </aside>

        <section className="gc-results" aria-live="polite">
          <MarketPanel gridParams={{ lowerLimit: lower, basePrice: base, upperLimit: upper, buyStep, sellStep, mode }} />

          {valid ? (
            <>
              <div className="gc-panel gc-capacity">
                <div className="gc-section-heading gc-section-heading-row">
                  <div>
                    <span>04</span>
                    <h2>行情推演</h2>
                  </div>
                  <div className="gc-mode-pill">{baselineMode === "rolling" ? "成交后滚动" : "固定基准"}</div>
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
                    {valid.firstMissedBuy ? <b>{valid.affordableBuyGrids === valid.positionBuyCapacity ? "最大持仓将在下一格买入前触及上限。" : `资金将在触及 ${money(valid.firstMissedBuy.trigger)} 元前不足。`}</b> : <b>当前现金和持仓上限可以覆盖全部下方网格。</b>}
                  </div>

                  <div className="gc-capacity-item" data-side="sell" data-safe={valid.executableSellGrids >= valid.sellRows.length}>
                    <div className="gc-capacity-title">
                      <span>连续上涨</span>
                      <strong>{valid.executableSellGrids}/{valid.sellRows.length}格</strong>
                    </div>
                    <div className="gc-meter"><i style={{ width: `${valid.sellRows.length ? Math.min(100, valid.executableSellGrids / valid.sellRows.length * 100) : 100}%` }} /></div>
                    <p>覆盖全部上方卖单需 {valid.requiredSellableLots} 手昨日可卖底仓。</p>
                    {valid.firstMissedSell ? <b>{valid.executableSellGrids === valid.sellCapacity ? "最小持仓将在下一格卖出前触及下限。" : `底仓将在触及 ${money(valid.firstMissedSell.trigger)} 元前耗尽，继续上涨可能踏空。`}</b> : <b>当前底仓和最小持仓限制可以覆盖全部上方网格。</b>}
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
                  <p>触及一层只执行一次，成交后才更新状态。</p>
                </div>

                <div className="gc-ladder-scroll">
                  <div className="gc-ladder">
                    {[...valid.levels].reverse().map((price) => {
                      const zone = Math.abs(price - base) < EPSILON ? "base" : price > base ? "sell" : "buy";
                      return (
                        <div className="gc-level" data-zone={zone} key={price}>
                          <span>{zone === "base" ? "初始基准" : zone === "sell" ? "上涨卖出" : "下跌买入"}</span>
                          <strong>{money(price)}</strong>
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
                      下限侧 {money(valid.lowerRemainder)} 元 · 上限侧 {money(valid.upperRemainder)} 元
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
                  <p>净收益按输入的往返成本率估算。</p>
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
                          <td>{money(row.low)} → {money(row.high)}</td>
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
  );
}

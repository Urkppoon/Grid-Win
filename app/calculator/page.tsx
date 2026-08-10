"use client";

import { useMemo, useState } from "react";

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

export default function CalculatorPage() {
  const [lower, setLower] = useState(120);
  const [upper, setUpper] = useState(133);
  const [base, setBase] = useState(126);
  const [baseSource, setBaseSource] = useState("manual");
  const [mode, setMode] = useState<GridMode>("price");
  const [sellStep, setSellStep] = useState(3);
  const [buyStep, setBuyStep] = useState(3);
  const [lotsPerGrid, setLotsPerGrid] = useState(1);
  const [roundTripCost, setRoundTripCost] = useState(0.15);
  const [cash, setCash] = useState(100000);
  const [sellableLots, setSellableLots] = useState(4);
  const [lockedLots, setLockedLots] = useState(0);
  const [baselineMode, setBaselineMode] = useState<BaselineMode>("rolling");

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
    for (const row of buyRows) {
      if (cashLeft + EPSILON < row.buyAmount) break;
      cashLeft -= row.buyAmount;
      affordableBuyGrids += 1;
    }

    const sellCapacity = Math.floor(sellableLots / lotsPerGrid);
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
    mode,
  ]);

  const hasError = Boolean(result.error);
  const valid = hasError ? null : result;
  const totalLots = sellableLots + lockedLots;

  return (
    <main className="gc-app">
      <header className="gc-hero">
        <div>
          <span className="gc-eyebrow">grid win · A股 T+1 网格设计</span>
          <h1>先算能不能跑，再看每格赚多少</h1>
          <p>
            用基准价生成上下网格，同时检查现金、昨日可卖底仓和今日锁定仓位。
          </p>
        </div>
        <div className="gc-status">
          <span className="gc-status-dot" />
          固定价格层 · 成交驱动
        </div>
      </header>

      <section className="gc-layout">
        <aside className="gc-panel gc-controls" aria-label="网格参数">
          <div className="gc-section-heading">
            <div>
              <span>01</span>
              <h2>价格与触发规则</h2>
            </div>
            <p>价格波动不移动网格；成交后是否滚动基准由你决定。</p>
          </div>

          <div className="gc-fields gc-fields-three">
            <Field label="价格下限（元）">
              <input type="number" min="0.01" step="0.01" value={lower} onChange={(event) => setLower(Number(event.target.value))} />
            </Field>
            <Field label="初始基准价（元）">
              <input type="number" min="0.01" step="0.01" value={base} onChange={(event) => setBase(Number(event.target.value))} />
            </Field>
            <Field label="价格上限（元）">
              <input type="number" min="0.01" step="0.01" value={upper} onChange={(event) => setUpper(Number(event.target.value))} />
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
              <input type="number" min="0.01" step="0.01" value={sellStep} onChange={(event) => setSellStep(Number(event.target.value))} />
            </Field>
            <Field label={`下跌买入${mode === "price" ? "价差（元）" : "比例（%）"}`}>
              <input type="number" min="0.01" step="0.01" value={buyStep} onChange={(event) => setBuyStep(Number(event.target.value))} />
            </Field>
          </div>

          <div className="gc-divider" />

          <div className="gc-section-heading">
            <div>
              <span>02</span>
              <h2>资金与T+1仓位</h2>
            </div>
            <p>1手按100股计算，当日买入不计入当日可卖。</p>
          </div>

          <div className="gc-fields gc-fields-two">
            <Field label="每格交易（手）">
              <input type="number" min="1" step="1" value={lotsPerGrid} onChange={(event) => setLotsPerGrid(Number(event.target.value))} />
            </Field>
            <Field label="估算往返成本率（%）">
              <input type="number" min="0" step="0.01" value={roundTripCost} onChange={(event) => setRoundTripCost(Number(event.target.value))} />
            </Field>
            <Field label="可用现金（元）">
              <input type="number" min="0" step="100" value={cash} onChange={(event) => setCash(Number(event.target.value))} />
            </Field>
            <Field label="昨日可卖底仓（手）">
              <input type="number" min="0" step="1" value={sellableLots} onChange={(event) => setSellableLots(Number(event.target.value))} />
            </Field>
            <Field label="今日买入锁定（手）" hint="仅计入总持仓，不增加今日卖出能力">
              <input type="number" min="0" step="1" value={lockedLots} onChange={(event) => setLockedLots(Number(event.target.value))} />
            </Field>
            <div className="gc-position-card">
              <span>当前总持仓</span>
              <strong>{integer(totalLots)}手</strong>
              <small>其中可卖 {integer(sellableLots)} 手</small>
            </div>
          </div>

          {hasError ? <div className="gc-error" role="alert">{result.error}</div> : null}
        </aside>

        <section className="gc-results" aria-live="polite">
          {valid ? (
            <>
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

              <div className="gc-panel gc-capacity">
                <div className="gc-section-heading gc-section-heading-row">
                  <div>
                    <span>03</span>
                    <h2>单边行情承受力</h2>
                  </div>
                  <div className="gc-mode-pill">{baselineMode === "rolling" ? "成交后滚动" : "固定基准"}</div>
                </div>

                <div className="gc-capacity-grid">
                  <div className="gc-capacity-item" data-safe={valid.affordableBuyGrids >= valid.buyRows.length}>
                    <div className="gc-capacity-title">
                      <span>连续下跌</span>
                      <strong>{valid.affordableBuyGrids}/{valid.buyRows.length}格</strong>
                    </div>
                    <div className="gc-meter"><i style={{ width: `${valid.buyRows.length ? Math.min(100, valid.affordableBuyGrids / valid.buyRows.length * 100) : 100}%` }} /></div>
                    <p>覆盖全部下方买单需 {money(valid.requiredDownCash)} 元。</p>
                    {valid.firstMissedBuy ? <b>资金将在触及 {money(valid.firstMissedBuy.trigger)} 元前不足。</b> : <b>当前现金可以覆盖全部下方网格。</b>}
                  </div>

                  <div className="gc-capacity-item" data-safe={valid.executableSellGrids >= valid.sellRows.length}>
                    <div className="gc-capacity-title">
                      <span>连续上涨</span>
                      <strong>{valid.executableSellGrids}/{valid.sellRows.length}格</strong>
                    </div>
                    <div className="gc-meter"><i style={{ width: `${valid.sellRows.length ? Math.min(100, valid.executableSellGrids / valid.sellRows.length * 100) : 100}%` }} /></div>
                    <p>覆盖全部上方卖单需 {valid.requiredSellableLots} 手昨日可卖底仓。</p>
                    {valid.firstMissedSell ? <b>底仓将在触及 {money(valid.firstMissedSell.trigger)} 元前耗尽，继续上涨可能踏空。</b> : <b>当前底仓可以覆盖全部上方网格。</b>}
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
                    <span>04</span>
                    <h2>价格层与买卖区域</h2>
                  </div>
                  <p>触及一层只执行一次，成交后才更新状态。</p>
                </div>

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
                    <span>05</span>
                    <h2>逐格金额与收益</h2>
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

              <footer className="gc-footnote">
                本工具用于策略规划，不连接实时行情，也不构成投资建议。条件触发不等于成交；涨跌停、跳空和流动性都可能造成实际成交偏差。
              </footer>
            </>
          ) : (
            <div className="gc-empty">修正左侧参数后，这里会生成完整的网格与承受力测算。</div>
          )}
        </section>
      </section>
    </main>
  );
}

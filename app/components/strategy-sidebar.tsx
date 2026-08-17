"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  GearSix,
  NotePencil,
  PencilSimple,
  Plus,
  SidebarSimple,
  SquaresFour,
  Trash,
} from "@phosphor-icons/react";

export type StrategySidebarItem = {
  id: string;
  stockCode: string;
  stockName: string;
  name: string;
  status: "running" | "paused";
  cash: number | null;
  lower: number | null;
  upper: number | null;
};

import { getPriceDecimals } from "../lib/tencent-technical";

type NewStrategyInput = {
  stockCode: string;
  stockName: string;
  name: string;
};

const amountText = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? "待填写"
    : `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)}`;

const intervalText = (lower: number | null, upper: number | null, stockCode: string) => {
  if (lower == null || upper == null || !Number.isFinite(lower) || !Number.isFinite(upper)) {
    return "区间待填写";
  }
  const decimals = getPriceDecimals(stockCode);
  return `${lower.toFixed(decimals)}–${upper.toFixed(decimals)}`;
};

function EclipseIcon({
  primaryColor = "#ffd60a",
  secondaryColor = "#30d158",
  accentColor = "#f5f5f7",
  size = 26,
}: {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.936 6.5a5.5 5.5 0 014.314 2" stroke={primaryColor} />
      <path d="M11.992 2A10 10 0 0119 4.852" stroke={primaryColor} />
      <path d="M12.996 12.914a5 5 0 014.976-.012" stroke={secondaryColor} />
      <path d="M18.494 13.231A4.5 4.5 0 0114 17.5" stroke={secondaryColor} />
      <path d="M4.858 19A10 10 0 0112 2" stroke={accentColor} />
      <path d="M8.019 15.788a5.5 5.5 0 013.904-9.287" stroke={primaryColor} />
    </svg>
  );
}

export default function StrategySidebar({
  collapsed,
  strategies,
  selectedId,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onToggleStatus,
  onDelete,
}: {
  collapsed: boolean;
  strategies: StrategySidebarItem[];
  selectedId: string;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: (input: NewStrategyInput) => void;
  onRename: (id: string, updates: { name: string; stockCode: string; stockName: string }) => void;
  onToggleStatus: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [stockCode, setStockCode] = useState("300408");
  const [stockName, setStockName] = useState("三环集团");
  const [strategyName, setStrategyName] = useState("新网格");
  const [renameTarget, setRenameTarget] = useState<StrategySidebarItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameStockCode, setRenameStockCode] = useState("");
  const [renameStockName, setRenameStockName] = useState("");

  const grouped = useMemo(() => {
    const groups = new Map<string, { stockCode: string; stockName: string; items: StrategySidebarItem[] }>();
    strategies.forEach((strategy) => {
      const key = `${strategy.stockCode}:${strategy.stockName}`;
      const group = groups.get(key) ?? {
        stockCode: strategy.stockCode,
        stockName: strategy.stockName,
        items: [],
      };
      group.items.push(strategy);
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [strategies]);

  const submitNewStrategy = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = stockCode.trim();
    const name = strategyName.trim();
    if (!code || !name) return;
    onCreate({
      stockCode: code,
      stockName: stockName.trim() || "未命名个股",
      name,
    });
    setShowCreate(false);
    setStrategyName("新网格");
  };

  const openRename = (strategy: StrategySidebarItem) => {
    setRenameTarget(strategy);
    setRenameName(strategy.name);
    setRenameStockCode(strategy.stockCode);
    setRenameStockName(strategy.stockName);
  };

  const openCreate = () => {
    if (collapsed) onToggle();
    setShowCreate(true);
  };

  const submitRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    onRename(renameTarget.id, {
      name,
      stockCode: renameStockCode.trim() || renameTarget.stockCode,
      stockName: renameStockName.trim() || renameTarget.stockName,
    });
    setRenameTarget(null);
  };

  return (
    <>
      <aside className="gc-strategy-sidebar" aria-label="策略侧边栏">
        <div className="gc-sidebar-brand">
          <button
            type="button"
            className="gc-gemini-logo-toggle"
            onClick={onToggle}
            aria-label={collapsed ? "打开边栏" : "收起边栏"}
            aria-expanded={!collapsed}
          >
            <span className="gc-logo-icon default-icon"><EclipseIcon primaryColor="#ffd60a" secondaryColor="#30d158" accentColor="#ffffff" /></span>
            <span className="gc-logo-icon hover-icon"><SidebarSimple weight="fill" /></span>
            <span className="gc-gemini-tooltip">{collapsed ? "打开边栏" : "收起边栏"}</span>
          </button>
          {!collapsed ? <strong>Grid Win</strong> : null}
        </div>

        <button
          type="button"
          className="gc-new-strategy-button"
          onClick={openCreate}
          aria-label="新建策略"
          title={collapsed ? "新建策略" : undefined}
        >
          <span className="gc-new-strategy-icon" aria-hidden="true">
            {collapsed ? <NotePencil weight="bold" /> : <Plus weight="bold" />}
          </span>
          {!collapsed ? <span className="gc-new-strategy-label">新建策略</span> : null}
          {collapsed ? <span className="gc-gemini-tooltip">新建策略</span> : null}
        </button>

        {!collapsed ? (
          <nav className="gc-strategy-groups" aria-label="按个股分组的策略列表">
            {grouped.map((group) => (
              <section className="gc-strategy-group" key={`${group.stockCode}:${group.stockName}`}>
                <h2><span>{group.stockCode || "未设置代码"}</span>{group.stockName}</h2>
                <div className="gc-strategy-list">
                  {group.items.map((strategy) => {
                    const selected = strategy.id === selectedId;
                    return (
                      <div className="gc-strategy-row" data-selected={selected} key={strategy.id}>
                        <button type="button" className="gc-strategy-select" onClick={() => onSelect(strategy.id)} aria-current={selected ? "page" : undefined}>
                          <strong>{strategy.name}</strong>
                          <small>{amountText(strategy.cash)} · {intervalText(strategy.lower, strategy.upper, strategy.stockCode)}</small>
                        </button>
                        <div className="gc-strategy-actions">
                          <button type="button" className="gc-strategy-rename" onClick={() => openRename(strategy)} aria-label={`修改策略名称：${strategy.name}`} title="修改策略名称">
                            <PencilSimple />
                          </button>
                          {onDelete ? (
                            <button
                              type="button"
                              className="gc-strategy-delete"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`确定要删除策略“${strategy.name}”吗？`)) {
                                  onDelete(strategy.id);
                                }
                              }}
                              aria-label={`删除策略：${strategy.name}`}
                              title="删除策略"
                            >
                              <Trash />
                            </button>
                          ) : null}
                          <button type="button" className="gc-strategy-status" data-status={strategy.status} onClick={() => onToggleStatus(strategy.id)} aria-label={`${strategy.name}：${strategy.status === "running" ? "运行中，点击暂停" : "已暂停，点击恢复"}`} title={strategy.status === "running" ? "点击暂停" : "点击恢复"}>
                            <i aria-hidden="true" />
                            <span>{strategy.status === "running" ? "运行中" : "已暂停"}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>
        ) : <div className="gc-collapsed-spacer" />}

        <div className="gc-sidebar-footer">
          <button type="button" title="归档策略"><Archive />{!collapsed ? <span>归档策略</span> : null}</button>
          <button type="button" title="设置"><GearSix />{!collapsed ? <span>设置</span> : null}</button>
        </div>
      </aside>

      {showCreate ? (
        <div className="gc-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <form className="gc-create-dialog" onSubmit={submitNewStrategy} aria-label="新建网格策略">
            <div className="gc-create-dialog-heading">
              <div><span>新建</span><h2>策略</h2></div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="关闭">关闭</button>
            </div>
            <label><span>股票代码</span><input value={stockCode} onChange={(event) => setStockCode(event.target.value)} /></label>
            <label><span>股票名称</span><input value={stockName} onChange={(event) => setStockName(event.target.value)} /></label>
            <label><span>策略名称</span><input value={strategyName} onChange={(event) => setStrategyName(event.target.value)} /></label>
            <p>每套策略的价格、资金与持仓会独立保存。</p>
            <div className="gc-create-dialog-actions">
              <button type="button" onClick={() => setShowCreate(false)}>取消</button>
              <button type="submit">创建策略</button>
            </div>
          </form>
        </div>
      ) : null}

      {renameTarget ? (
        <div className="gc-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}>
          <form className="gc-create-dialog" onSubmit={submitRename} aria-label="编辑策略">
            <div className="gc-create-dialog-heading">
              <div><span>编辑</span><h2>策略设置</h2></div>
              <button type="button" onClick={() => setRenameTarget(null)} aria-label="关闭">关闭</button>
            </div>
            <label><span>股票代码</span><input value={renameStockCode} onChange={(event) => setRenameStockCode(event.target.value)} /></label>
            <label><span>股票名称</span><input value={renameStockName} onChange={(event) => setRenameStockName(event.target.value)} /></label>
            <label><span>策略名称</span><input value={renameName} onChange={(event) => setRenameName(event.target.value)} /></label>
            <div className="gc-create-dialog-actions">
              <button type="button" onClick={() => setRenameTarget(null)}>取消</button>
              <button type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

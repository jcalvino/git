import React, { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export function EquityCurve({ snapshots = [] }) {
  const chartRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || snapshots.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 220,
      layout: {
        background: { color: "#1A1A24" },
        textColor: "#9CA3AF",
      },
      grid: {
        vertLines: { color: "#2A2A3A" },
        horzLines: { color: "#2A2A3A" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#00D4FF", labelBackgroundColor: "#00D4FF" },
        horzLine: { color: "#00D4FF", labelBackgroundColor: "#00D4FF" },
      },
      rightPriceScale: {
        borderColor: "#2A2A3A",
      },
      timeScale: {
        borderColor: "#2A2A3A",
        timeVisible: true,
      },
    });

    chartRef.current = chart;

    const areaSeries = chart.addAreaSeries({
      lineColor: "#00D4FF",
      topColor: "rgba(0, 212, 255, 0.25)",
      bottomColor: "rgba(0, 212, 255, 0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    const data = snapshots.map((s) => ({
      time: s.date,
      value: s.capital,
    }));

    areaSeries.setData(data);
    chart.timeScale().fitContent();

    const resize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
    };
  }, [snapshots]);

  if (snapshots.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-muted text-sm">
        Nenhum dado de equity ainda. Execute o primeiro scan.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}

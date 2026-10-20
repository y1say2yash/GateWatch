import type { ReactElement } from 'react';

import type { MonitoringTimeSeriesPoint } from '../types/monitoring';

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  value: (point: MonitoringTimeSeriesPoint) => number | null;
}

interface MonitoringChartProps {
  title: string;
  description: string;
  axisLabel: string;
  points: MonitoringTimeSeriesPoint[];
  series: ChartSeries[];
  bucketSize: 'hour' | 'day';
  valueFormat: (value: number) => string;
}

const chartWidth = 720;
const chartHeight = 340;
const chartMargins = { top: 18, right: 18, bottom: 64, left: 58 };
const dateLabelFormatters = {
  hour: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }),
  day: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
};

function dateLabel(timestamp: string, bucketSize: 'hour' | 'day'): string {
  return dateLabelFormatters[bucketSize].format(new Date(timestamp));
}

function lineSegments(
  points: MonitoringTimeSeriesPoint[],
  series: ChartSeries,
  xPosition: (index: number) => number,
  yPosition: (value: number) => number,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    const value = series.value(point);
    if (value === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length ? 'L' : 'M'} ${xPosition(index)} ${yPosition(value)}`);
  });
  if (current.length) segments.push(current.join(' '));
  return segments;
}

export function MonitoringChart({
  title,
  description,
  axisLabel,
  points,
  series,
  bucketSize,
  valueFormat,
}: MonitoringChartProps): ReactElement {
  const plotWidth = chartWidth - chartMargins.left - chartMargins.right;
  const plotHeight = chartHeight - chartMargins.top - chartMargins.bottom;
  const maximum = Math.max(
    1,
    ...points.flatMap((point) =>
      series.map((item) => item.value(point)).filter((value): value is number => value !== null),
    ),
  );
  const xPosition = (index: number): number =>
    chartMargins.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yPosition = (value: number): number =>
    chartMargins.top + plotHeight - (value / maximum) * plotHeight;
  const tickIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <section className="panel monitoring-chart-panel" aria-label={title}>
      <h3>{title}</h3>
      <p>{description}</p>
      <ul className="monitoring-chart-legend" aria-label={`${title} legend`}>
        {series.map((item) => (
          <li key={item.key}>
            <span className="monitoring-chart-swatch" style={{ backgroundColor: item.color }} />
            {item.label}
          </li>
        ))}
      </ul>
      {points.length === 0 ? (
        <p className="monitoring-chart-empty">No recorded observations are available for this chart.</p>
      ) : (
        <svg
          className="monitoring-chart-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${description}. Vertical axis: ${axisLabel}. Horizontal axis: time in local time.`}
        >
          <title>{title}</title>
          <desc>{description}</desc>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const value = maximum * fraction;
            const y = yPosition(value);
            return (
              <g key={fraction}>
                <line
                  x1={chartMargins.left}
                  x2={chartWidth - chartMargins.right}
                  y1={y}
                  y2={y}
                  className="monitoring-chart-gridline"
                />
                <text x={chartMargins.left - 8} y={y + 4} textAnchor="end" className="monitoring-chart-tick">
                  {valueFormat(value)}
                </text>
              </g>
            );
          })}
          {series.map((item) => lineSegments(points, item, xPosition, yPosition).map((path, segmentIndex) => (
            <path
              key={`${item.key}-${segmentIndex}`}
              d={path}
              fill="none"
              stroke={item.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )))}
          {series.flatMap((item) => points.map((point, index) => {
            const value = item.value(point);
            if (value === null) return null;
            return (
              <circle
                key={`${item.key}-${point.bucketStart}`}
                cx={xPosition(index)}
                cy={yPosition(value)}
                r="3.5"
                fill={item.color}
              >
                <title>{`${item.label}: ${valueFormat(value)} at ${new Date(point.bucketStart).toLocaleString()}`}</title>
              </circle>
            );
          }))}
          {tickIndices.map((index) => {
            const point = points[index];
            return point ? (
              <text
                key={point.bucketStart}
                x={xPosition(index)}
                y={chartHeight - chartMargins.bottom + 20}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                className="monitoring-chart-tick"
              >
                {dateLabel(point.bucketStart, bucketSize)}
              </text>
            ) : null;
          })}
          <text
            x={chartMargins.left + plotWidth / 2}
            y={chartHeight - 8}
            textAnchor="middle"
            className="monitoring-chart-axis-label"
          >
            Time (local)
          </text>
          <text
            transform={`translate(15 ${chartMargins.top + plotHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            className="monitoring-chart-axis-label"
          >
            {axisLabel}
          </text>
        </svg>
      )}
      <table className="visually-hidden">
        <caption>{title} data by {bucketSize} bucket</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {series.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucketStart}>
              <th scope="row">{new Date(point.bucketStart).toLocaleString()}</th>
              {series.map((item) => {
                const value = item.value(point);
                return <td key={item.key}>{value === null ? 'Not available' : valueFormat(value)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export interface MonitoringBarDatum {
  label: string;
  value: number;
  color: string;
  detail?: string;
}

interface MonitoringBarChartProps {
  title: string;
  description: string;
  axisLabel: string;
  items: MonitoringBarDatum[];
  valueFormat?: (value: number) => string;
}

export function MonitoringBarChart({
  title,
  description,
  axisLabel,
  items,
  valueFormat = (value) => Math.round(value).toLocaleString(),
}: MonitoringBarChartProps): ReactElement {
  const width = 720;
  const rowHeight = 38;
  const top = 12;
  const bottom = 44;
  const labelWidth = 160;
  const plotWidth = width - labelWidth - 64;
  const height = Math.max(180, top + items.length * rowHeight + bottom);
  const maximum = Math.max(1, ...items.map((item) => item.value));

  return (
    <section className="panel monitoring-chart-panel" aria-label={title}>
      <h3>{title}</h3>
      <p>{description}</p>
      {items.length === 0 ? (
        <p className="monitoring-chart-empty">No recorded data is available for this chart.</p>
      ) : (
        <svg
          className="monitoring-chart-svg monitoring-bar-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${title}. ${description}. Horizontal axis: ${axisLabel}.`}
        >
          <title>{title}</title>
          <desc>{description}</desc>
          {[0, 0.5, 1].map((fraction) => {
            const x = labelWidth + plotWidth * fraction;
            return (
              <g key={fraction}>
                <line x1={x} x2={x} y1={top} y2={height - bottom} className="monitoring-chart-gridline" />
                <text x={x} y={height - bottom + 18} textAnchor="middle" className="monitoring-chart-tick">
                  {valueFormat(maximum * fraction)}
                </text>
              </g>
            );
          })}
          {items.map((item, index) => {
            const y = top + index * rowHeight;
            const barWidth = Math.max(0, (item.value / maximum) * plotWidth);
            const shortLabel = item.label.length > 24 ? `${item.label.slice(0, 21)}…` : item.label;
            return (
              <g key={`${item.label}-${index}`}>
                <text x={labelWidth - 10} y={y + 19} textAnchor="end" className="monitoring-chart-tick">
                  <title>{item.label}</title>
                  {shortLabel}
                </text>
                <rect
                  x={labelWidth}
                  y={y + 4}
                  width={barWidth}
                  height={22}
                  rx={5}
                  fill={item.color}
                >
                  <title>{`${item.label}: ${valueFormat(item.value)}${item.detail ? ` (${item.detail})` : ''}`}</title>
                </rect>
                <text x={labelWidth + barWidth + 8} y={y + 20} className="monitoring-chart-tick">
                  {valueFormat(item.value)}
                </text>
              </g>
            );
          })}
          <text
            x={labelWidth + plotWidth / 2}
            y={height - 8}
            textAnchor="middle"
            className="monitoring-chart-axis-label"
          >
            {axisLabel}
          </text>
        </svg>
      )}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Category</th><th scope="col">{axisLabel}</th></tr></thead>
        <tbody>{items.map((item, index) => (
          <tr key={`${item.label}-${index}`}><th scope="row">{item.label}</th><td>{valueFormat(item.value)}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

interface MonitoringPieChartProps {
  title: string;
  description: string;
  items: MonitoringBarDatum[];
}

export function MonitoringPieChart({
  title,
  description,
  items,
}: MonitoringPieChartProps): ReactElement {
  const entries = items.filter((item) => Number.isFinite(item.value) && item.value >= 0);
  const slices = entries.filter((item) => item.value > 0);
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  const center = 110;
  const radius = 84;
  const slicePaths = slices.map((item, index) => {
    const precedingValue = slices.slice(0, index).reduce((sum, slice) => sum + slice.value, 0);
    const startAngle = -Math.PI / 2 + (precedingValue / total) * Math.PI * 2;
    const endAngle = startAngle + (item.value / total) * Math.PI * 2;
    const startX = center + radius * Math.cos(startAngle);
    const startY = center + radius * Math.sin(startAngle);
    const endX = center + radius * Math.cos(endAngle);
    const endY = center + radius * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    return {
      ...item,
      path: `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`,
    };
  });

  return (
    <section className="panel monitoring-chart-panel" aria-label={title}>
      <h3>{title}</h3>
      <p>{description}</p>
      {slicePaths.length === 0 ? (
        <p className="monitoring-chart-empty">No positive status-code counts were recorded for this range.</p>
      ) : (
        <svg
          className="monitoring-chart-svg monitoring-pie-chart-svg"
          viewBox="0 0 220 220"
          role="img"
          aria-label={`${title}. ${description}. Total responses: ${total.toLocaleString()}.`}
        >
          <title>{title}</title>
          <desc>{description}</desc>
          {slicePaths.length === 1 ? (
            <circle cx={center} cy={center} r={radius} fill={slicePaths[0]?.color}>
              <title>{`HTTP ${slicePaths[0]?.label}: ${slicePaths[0]?.value.toLocaleString()}`}</title>
            </circle>
          ) : slicePaths.map((slice) => (
            <path key={slice.label} d={slice.path} fill={slice.color}>
              <title>{`HTTP ${slice.label}: ${slice.value.toLocaleString()}`}</title>
            </path>
          ))}
        </svg>
      )}
      {entries.length > 0 && (
        <ul className="monitoring-chart-legend" aria-label={`${title} legend`}>
          {entries.map((item) => (
            <li key={item.label}>
              <span className="monitoring-chart-swatch" style={{ backgroundColor: item.color }} />
              HTTP {item.label}: {item.value.toLocaleString()}
            </li>
          ))}
        </ul>
      )}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead><tr><th scope="col">HTTP status</th><th scope="col">Responses</th></tr></thead>
        <tbody>{entries.map((item) => (
          <tr key={item.label}><th scope="row">HTTP {item.label}</th><td>{item.value.toLocaleString()}</td></tr>
        ))}</tbody>
      </table>
    </section>
  );
}

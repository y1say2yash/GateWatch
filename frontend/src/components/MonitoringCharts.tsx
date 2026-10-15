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
const chartHeight = 280;
const chartMargins = { top: 18, right: 18, bottom: 54, left: 58 };
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
      <div className="monitoring-chart-scroll">
        <svg
          className="monitoring-chart-svg"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
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
      </div>
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

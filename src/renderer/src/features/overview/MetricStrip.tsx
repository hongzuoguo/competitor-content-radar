export function MetricStrip({
  items
}: {
  items: Array<{ label: string; value: string | number; note?: string }>
}): React.JSX.Element {
  return (
    <dl className="metric-strip" aria-label="今日关键数据">
      {items.map((item) => (
        <div className="metric-strip__item" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="metric-strip__value">{item.value}</dd>
          {item.note ? <span className="metric-strip__note">{item.note}</span> : null}
        </div>
      ))}
    </dl>
  )
}

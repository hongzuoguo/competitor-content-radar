export function MetricStrip({
  items
}: {
  items: Array<{ label: string; value: string | number; note?: string; onClick?: () => void }>
}): React.JSX.Element {
  return (
    <div className="metric-strip" aria-label="关键数据">
      {items.map((item) => {
        const content = <>
          <span className="metric-strip__label">{item.label}</span>
          <strong className="metric-strip__value">{item.value}</strong>
          {item.note ? <span className="metric-strip__note">{item.note}</span> : null}
        </>
        return item.onClick
          ? <button className="metric-strip__item metric-strip__item--action" key={item.label} onClick={item.onClick} type="button">{content}</button>
          : <div className="metric-strip__item" key={item.label}>{content}</div>
      })}
    </div>
  )
}

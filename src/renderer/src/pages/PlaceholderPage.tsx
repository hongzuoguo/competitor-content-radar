export function PlaceholderPage({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="page">
      <header className="page-heading"><div><h1>{title}</h1><p>页面正在接入本地数据。</p></div></header>
    </div>
  )
}

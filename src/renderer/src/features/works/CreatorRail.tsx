import type { CreatorView } from '../../../../shared/ipc-contract'

export function CreatorRail({ creators, selectedId, onSelect }: {
  creators: CreatorView[]
  selectedId: string | null
  onSelect(id: string): void
}): React.JSX.Element {
  const enabled = creators.filter((creator) => creator.enabled)
  return (
    <section aria-label="已订阅博主" className="creator-rail">
      <header><div><h2>订阅博主</h2><span>{enabled.length} 位</span></div><a href="/creators">添加博主</a></header>
      {enabled.length === 0 ? <p className="workspace-empty-copy">还没有启用的订阅。添加博主后，作品会按天自动更新。</p> : (
        <div className="creator-rail__list">
          {enabled.map((creator) => (
            <button aria-pressed={selectedId === creator.id} key={creator.id} onClick={() => onSelect(creator.id)} type="button">
              <span className="avatar" aria-hidden="true">{creator.name.slice(0, 1)}</span>
              <span><strong>{creator.name}</strong><small>{creator.works} 条作品 · {creator.lastRun}</small></span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

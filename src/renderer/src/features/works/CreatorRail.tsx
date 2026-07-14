import { Link } from 'react-router-dom'
import type { CreatorView, WorkListItem } from '../../../../shared/ipc-contract'

export const UNCLASSIFIED_CREATOR_ID = '__unclassified__'

interface CreatorRailItem {
  id: string
  name: string
  detail: string
  works: number
}

export function CreatorRail({ creators, works, selectedId, onSelect }: {
  creators: CreatorView[]
  works: WorkListItem[]
  selectedId: string | null
  onSelect(id: string): void
}): React.JSX.Element {
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]))
  const worksByCreator = new Map<string, WorkListItem[]>()
  for (const work of works) {
    if (!work.creatorId) continue
    worksByCreator.set(work.creatorId, [...(worksByCreator.get(work.creatorId) ?? []), work])
  }

  const items: CreatorRailItem[] = creators
    .filter((creator) => creator.enabled || worksByCreator.has(creator.id))
    .map((creator) => ({
      id: creator.id,
      name: creator.name,
      detail: creator.enabled ? creator.lastRun : '已停用',
      works: worksByCreator.get(creator.id)?.length ?? creator.works
    }))

  for (const [creatorId, creatorWorks] of worksByCreator) {
    if (creatorById.has(creatorId)) continue
    items.push({ id: creatorId, name: creatorWorks[0].creatorName, detail: '历史博主', works: creatorWorks.length })
  }

  const unclassifiedWorks = works.filter((work) => work.creatorId === null)
  if (unclassifiedWorks.length > 0) {
    items.push({ id: UNCLASSIFIED_CREATOR_ID, name: '未分类作品', detail: '手动导入', works: unclassifiedWorks.length })
  }

  return (
    <section aria-labelledby="subscription-creators-title" className="creator-rail">
      <header><div><h2 id="subscription-creators-title">作品来源</h2><span>{items.length} 组</span></div><Link to="/creators">添加博主</Link></header>
      {items.length === 0 ? <p className="workspace-empty-copy">还没有启用的订阅。添加博主后，作品会按天自动更新。</p> : (
        <div className="creator-rail__list">
          {items.map((item) => (
            <button aria-pressed={selectedId === item.id} key={item.id} onClick={() => onSelect(item.id)} type="button">
              <span className="avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>
              <span><strong>{item.name}</strong><small>{item.works} 条作品 · {item.detail}</small></span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

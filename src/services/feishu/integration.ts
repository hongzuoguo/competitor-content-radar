import type { Work } from '../../core/domain'
import { chinaDateKey } from '../../core/local-date'
import {
  calculateEngagement,
  evaluateHighlight,
  type HighlightEvaluation,
  type HighlightReason,
  type HighlightThresholdOverrides
} from '../../core/highlight-rules'
import type {
  FeishuCustomAppConnectionInput,
  FeishuConnectionView,
  FeishuConnectionStatus,
  PublicSettings
} from '../../shared/ipc-contract'
import type { WeeklyTopicClusterResult, WeeklyTopicWork } from '../ai/weekly-topic-clustering'
import {
  type ContentTermCandidateWork,
  type ContentTermClusterResult
} from '../ai/content-term-clustering'
import type {
  AnalysisRecord,
  AppRepositories,
  MetricSnapshotRecord
} from '../database/repositories'
import {
  FeishuBaseMissingError,
  FeishuBaseSelectionError,
  FeishuSchemaError,
  FeishuSyncService,
  type FeishuBitableApi,
  type FeishuUpsertItem,
  type ProvisionedBase
} from './bitable'
import {
  parseFeishuBaseReference,
  type FeishuAccessTokenProvider,
  type FeishuCustomAppCredentials
} from './custom-app-auth'
import { toFeishuUserError } from './user-error'
import { FEISHU_BASE_SCHEMA, type FeishuTableKey } from './schema'
import { isWeakKeyword } from './keyword-quality'
import {
  buildCreativeDirections,
  buildGrowthTop10,
  buildHotContentTerms,
  type FeishuSummaryWork
} from './summaries'
import { extractTitlePhraseCandidates } from './title-phrase-extractor'
import {
  assignmentsFromCluster,
  createTopicClassificationSignature,
  fallbackTopicAssignments,
  type PersistedTopicAssignments,
  type TopicAssignmentSet,
  type TopicEvidenceWork
} from './topic-consolidation'

interface CredentialStore {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

type FeishuConnectionApi = FeishuBitableApi & {
  resolveWikiNode(nodeToken: string): Promise<{ objType: string; objToken: string }>
}

interface FeishuIntegrationDependencies {
  repositories: AppRepositories
  credentials: CredentialStore
  tokenProviderFactory(credentials: FeishuCustomAppCredentials): FeishuAccessTokenProvider
  clientFactory(accessToken: string): FeishuConnectionApi
  openExternal(url: string): Promise<void>
  clusterTopics?(works: WeeklyTopicWork[], preferredCategoryNames: string[]): Promise<WeeklyTopicClusterResult>
  clusterContentTerms?(works: ContentTermCandidateWork[]): Promise<ContentTermClusterResult>
  classifierTopicVersion?: string
  now?: () => Date
  log?: (message: string, detail?: unknown) => void
}

interface WorkDecision {
  current: boolean
  expired: boolean
  highlight: HighlightEvaluation
}

const CUSTOM_APP_KEY = 'feishu.customApp'
const LEGACY_OAUTH_KEY = 'feishu.oauth'
const CANDIDATES_KEY = 'feishu.baseCandidates'
const TOPIC_ASSIGNMENTS_KEY = 'feishu.topicAssignments'
const CONTENT_TERM_CLUSTERS_KEY = 'feishu.contentTermClusters'
export const TOPIC_CLASSIFIER_VERSION = 'v1'

interface PersistedContentTermClusters {
  signature: string
  result: ContentTermClusterResult
}

export class FeishuIntegration {
  private readonly now: () => Date
  private readonly classifierTopicVersion: string
  private transientStatus: FeishuConnectionStatus | null = null
  private syncPromise: Promise<FeishuConnectionView> | null = null
  private activeDataSync: Promise<void> | null = null
  private syncTail: Promise<void> = Promise.resolve()
  private tokenProvider: FeishuAccessTokenProvider | null = null

  constructor(private readonly dependencies: FeishuIntegrationDependencies) {
    this.now = dependencies.now ?? (() => new Date())
    this.classifierTopicVersion = dependencies.classifierTopicVersion ?? TOPIC_CLASSIFIER_VERSION
    this.dependencies.credentials.delete(LEGACY_OAUTH_KEY)
  }

  private log(message: string, detail?: unknown): void {
    this.dependencies.log?.(message, detail)
  }

  getConnection(): FeishuConnectionView {
    const binding = this.dependencies.repositories.feishu.getBinding()
    const candidates = this.dependencies.repositories.settings.get<Array<{ appToken: string; url: string }>>(CANDIDATES_KEY)
    const credentials = this.readCustomCredentials()
    if (this.transientStatus) {
      return view(
        this.transientStatus,
        binding,
        statusMessage(this.transientStatus),
        credentials,
        candidates ?? undefined
      )
    }
    if (!credentials) {
      return view(
        'disconnected',
        binding,
        binding
          ? '原飞书登录方式已停用，请配置你自己的飞书应用'
          : '尚未配置飞书同步',
        null
      )
    }
    if (candidates?.length) {
      return view(
        'needs_repair',
        binding,
        '找到多份同名多维表格，请选择要继续维护的一份',
        credentials,
        candidates
      )
    }
    if (binding?.status === 'needs_repair') {
      return view(
        'needs_repair',
        binding,
        binding.errorMessage ?? '表结构需要修复',
        credentials,
        candidates ?? undefined
      )
    }
    if (binding?.status === 'sync_error') {
      return view('sync_error', binding, binding.errorMessage ?? '最近一次同步失败', credentials)
    }
    return binding
      ? view('connected', binding, '已连接“对标内容雷达”', credentials)
      : view('disconnected', null, '请重新配置飞书同步', credentials)
  }

  async connectCustomApp(input: FeishuCustomAppConnectionInput): Promise<FeishuConnectionView> {
    return this.enqueueSync(async () => {
      const candidateCredentials = {
        appId: input.appId.trim(),
        appSecret: input.appSecret.trim()
      }
      const reference = parseFeishuBaseReference(input.baseUrl)
      const candidateProvider = this.dependencies.tokenProviderFactory(candidateCredentials)
      let saved = false
      this.transientStatus = 'provisioning'
      try {
        const accessToken = await candidateProvider.getAccessToken()
        const api = this.dependencies.clientFactory(accessToken)
        const appToken = reference.kind === 'base'
          ? reference.appToken
          : await resolveWikiBitableToken(api, reference.nodeToken)
        const baseUrl = normalizedBaseUrl(input.baseUrl, appToken)
        await api.listTables(appToken)
        const service = new FeishuSyncService(api)
        const provisioned = await service.ensureBase(appToken, {})
        const base = { ...provisioned, url: baseUrl }

        this.dependencies.credentials.set(CUSTOM_APP_KEY, JSON.stringify(candidateCredentials))
        this.tokenProvider = candidateProvider
        this.saveBase(base)
        this.dependencies.repositories.settings.set(CANDIDATES_KEY, [])
        saved = true
        this.transientStatus = null
        return this.getConnection()
      } catch (error) {
        const actionable = actionableError(error)
        if (saved) this.saveFailure(actionable)
        throw actionable
      } finally {
        this.transientStatus = null
      }
    })
  }

  async repair(selectedAppToken?: string): Promise<FeishuConnectionView> {
    return this.enqueueSync(() =>
      this.provision(
        selectedAppToken ?? this.dependencies.repositories.feishu.getBinding()?.appToken,
        { repairDeletedFields: true }
      )
    )
  }

  async recreate(): Promise<FeishuConnectionView> {
    if (!this.readCustomCredentials()) throw new Error('FEISHU_NOT_AUTHORIZED')
    return this.enqueueSync(() => this.provision())
  }

  async disconnect(): Promise<FeishuConnectionView> {
    return this.enqueueSync(async () => {
      this.dependencies.credentials.delete(CUSTOM_APP_KEY)
      this.dependencies.credentials.delete(LEGACY_OAUTH_KEY)
      this.tokenProvider = null
      this.dependencies.repositories.feishu.clear()
      this.dependencies.repositories.settings.set(CANDIDATES_KEY, [])
      return this.getConnection()
    })
  }

  private async getAccessToken(): Promise<string> {
    const credentials = this.readCustomCredentials()
    if (!credentials) throw new Error('FEISHU_NOT_AUTHORIZED')
    this.tokenProvider ??= this.dependencies.tokenProviderFactory(credentials)
    try {
      return await this.tokenProvider.getAccessToken()
    } catch (error) {
      throw actionableError(error)
    }
  }

  async syncAll(): Promise<FeishuConnectionView> {
    if (this.syncPromise) return this.syncPromise
    this.syncPromise = this.enqueueSync(() => this.performSync()).finally(() => {
      this.syncPromise = null
    })
    return this.syncPromise
  }

  waitForActiveDataSync(): Promise<void> {
    return this.activeDataSync ?? Promise.resolve()
  }

  async syncWork(workId: string, refreshSemanticSummaries = true): Promise<void> {
    return this.enqueueSync(() => this.performWorkSync(workId, refreshSemanticSummaries))
  }

  private async performWorkSync(workId: string, refreshSemanticSummaries: boolean): Promise<void> {
    const binding = this.dependencies.repositories.feishu.getBinding()
    if (!binding || !this.readCustomCredentials()) return
    try {
      const client = new FeishuSyncService(this.dependencies.clientFactory(await this.getAccessToken()))
      const base = await client.ensureBase(binding.appToken, this.knownFields())
      this.saveBase(base)
      const work = this.dependencies.repositories.works.get(workId)
      if (!work) return
      const now = this.now()
      const allWorks = this.dependencies.repositories.works.listAll()
      this.initializeLegacyFirstSyncTimes(allWorks, now)
      const decisions = this.workDecisions(allWorks, now)
      const currentWorks = allWorks.filter((candidate) => decisions.get(candidate.id)?.current)
      const topicAssignments = await this.resolveTopicAssignments(currentWorks, false)
      const decision = decisions.get(work.id)
      if (!decision) return
      if (decision.current) {
        if (work.creatorId) {
          const creator = this.dependencies.repositories.creators.getById(work.creatorId)
          if (creator) await this.syncCreator(client, base, creator)
        }
        await this.syncOneWork(client, base, work, 'works', decision, topicAssignments.assignments.get(work.id))
        for (const snapshot of this.dependencies.repositories.snapshots.listByWork(workId)) {
          await this.syncSnapshot(client, base, snapshot)
        }
      } else if (decision.expired && this.dependencies.repositories.feishu.getRecordMapping('works', work.id)) {
        const creator = work.creatorId ? this.dependencies.repositories.creators.getById(work.creatorId) : null
        if (creator) await this.syncCreator(client, base, creator)
        await this.syncOneWork(client, base, work, 'worksArchive', decision)
        await this.removeCurrentWork(client, base, work)
      } else {
        await this.removeCurrentWork(client, base, work)
      }
      await this.reconcileMappedWorks(client, base, allWorks, decisions)
      await this.syncManagedSummaries(
        client,
        base,
        allWorks.filter((candidate) => decisions.get(candidate.id)?.current),
        now,
        topicAssignments.assignments,
        refreshSemanticSummaries
      )
      const currentBinding = this.dependencies.repositories.feishu.getBinding()
      if (currentBinding) this.markConnected(currentBinding)
    } catch (error) {
      this.saveFailure(error)
      throw error
    }
  }

  private enqueueSync<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.syncTail.then(operation, operation)
    this.syncTail = result.then(() => undefined, () => undefined)
    return result
  }

  async openBase(): Promise<void> {
    const url = this.dependencies.repositories.feishu.getBinding()?.baseUrl
    if (!url) throw new Error('FEISHU_BASE_UNAVAILABLE')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('FEISHU_BASE_URL_INVALID')
    await this.dependencies.openExternal(parsed.toString())
  }

  async openDeveloperConsole(): Promise<void> {
    await this.dependencies.openExternal('https://open.feishu.cn/app')
  }

  private async provision(
    selectedAppToken?: string,
    options: { repairDeletedFields?: boolean } = {}
  ): Promise<FeishuConnectionView> {
    this.transientStatus = 'provisioning'
    try {
      const service = new FeishuSyncService(this.dependencies.clientFactory(await this.getAccessToken()))
      const base = await service.ensureBase(selectedAppToken, this.knownFields(), options)
      this.saveBase(base)
      this.dependencies.repositories.settings.set(CANDIDATES_KEY, [])
      this.transientStatus = null
      return this.getConnection()
    } catch (error) {
      if (error instanceof FeishuBaseSelectionError) {
        this.dependencies.repositories.settings.set(CANDIDATES_KEY, error.candidates)
        return view(
          'needs_repair',
          null,
          error.message,
          this.readCustomCredentials(),
          error.candidates
        )
      }
      this.saveFailure(error)
      throw error
    } finally {
      this.transientStatus = null
    }
  }

  private async performSync(): Promise<FeishuConnectionView> {
    const binding = this.dependencies.repositories.feishu.getBinding()
    if (!binding) throw new Error('FEISHU_NOT_CONNECTED')
    try {
      const service = new FeishuSyncService(this.dependencies.clientFactory(await this.getAccessToken()))
      const base = await service.ensureBase(binding.appToken, this.knownFields())
      this.saveBase(base)
      await this.syncWith(service, base)
      return this.getConnection()
    } catch (error) {
      this.saveFailure(error)
      throw error
    }
  }

  private syncWith(service: FeishuSyncService, base: ProvisionedBase): Promise<void> {
    const operation = this.performSyncWith(service, base)
    const tracked = operation.finally(() => {
      if (this.activeDataSync === tracked) this.activeDataSync = null
    })
    this.activeDataSync = tracked
    return tracked
  }

  private async performSyncWith(service: FeishuSyncService, base: ProvisionedBase): Promise<void> {
    this.transientStatus = 'syncing_data'
    try {
      // 新作品按发布时间范围进入作品分析；已进入的作品按首次同步时间保留，
      // 超过保留时间后移入归档。我的作品无需爆款，对标作品仍需命中爆款特征。
      const now = this.now()
      const allWorks = this.dependencies.repositories.works.listAll()
      const creators = this.dependencies.repositories.creators.list()
      const snapshots = this.dependencies.repositories.snapshots.list()
      this.initializeLegacyFirstSyncTimes(allWorks, now)
      const decisions = this.workDecisions(allWorks, now)
      const currentWorks = allWorks.filter((work) => decisions.get(work.id)?.current)
      const topicAssignments = await this.resolveTopicAssignments(currentWorks, true)
      await this.reconcileOrphanedMappings(service, base, {
        creatorIds: new Set(creators.map((creator) => creator.id)),
        workIds: new Set(allWorks.map((work) => work.id)),
        snapshotIds: new Set(snapshots.map((snapshot) => snapshotIdentity(snapshot.workId, snapshot.capturedAt)))
      })
      const currentWorkIds = new Set(currentWorks.map((work) => work.id))
      const expiredWorks = allWorks.filter((work) => (
        decisions.get(work.id)?.expired && this.dependencies.repositories.feishu.getRecordMapping('works', work.id)
      ))
      const creatorIds = new Set([...currentWorks, ...expiredWorks]
        .map((work) => work.creatorId)
        .filter((creatorId): creatorId is string => creatorId !== null))
      await this.syncBatch(
        service,
        base,
        'creators',
        fieldName(base, 'creators', 'creatorId', ''),
        creators
          .filter((creator) => creatorIds.has(creator.id))
          .map((creator) => this.creatorItem(base, creator))
      )
      await this.syncBatch(
        service,
        base,
        'works',
        fieldName(base, 'works', 'workId', '作品ID'),
        currentWorks.map((work) => this.workItem(
          base,
          work,
          'works',
          decisions.get(work.id),
          topicAssignments.assignments.get(work.id)
        ))
      )
      if (expiredWorks.length > 0) {
        await this.syncBatch(
          service,
          base,
          'worksArchive',
          fieldName(base, 'worksArchive', 'workId', '作品ID'),
          expiredWorks.map((work) => this.workItem(base, work, 'worksArchive', decisions.get(work.id)))
        )
        for (const work of expiredWorks) await this.removeCurrentWork(service, base, work)
      }
      for (const work of allWorks) {
        if (!decisions.get(work.id)?.current) {
          await this.removeCurrentWork(service, base, work)
        }
      }
      await this.syncBatch(
        service,
        base,
        'snapshots',
        fieldName(base, 'snapshots', 'snapshotId', '快照ID'),
        latestDailySnapshots(snapshots
          .filter((snapshot) => currentWorkIds.has(snapshot.workId)))
          .map((snapshot) => this.snapshotItem(base, snapshot))
      )
      await this.syncManagedSummaries(service, base, currentWorks, now, topicAssignments.assignments)
      const binding = this.dependencies.repositories.feishu.getBinding()
      if (binding) this.markConnected(binding)
    } finally {
      this.transientStatus = null
    }
  }

  private async resolveTopicAssignments(
    works: Work[],
    useSelectedEngine: boolean
  ): Promise<TopicAssignmentSet> {
    const previous = this.dependencies.repositories.settings.get<PersistedTopicAssignments>(TOPIC_ASSIGNMENTS_KEY)
      ?? undefined
    const evidence = works
      .map((work) => this.topicEvidence(work))
      .sort((left, right) => left.id.localeCompare(right.id))
    const signature = createTopicClassificationSignature({
      version: this.classifierTopicVersion,
      works: evidence
    })

    if (useSelectedEngine && evidence.length === 0) {
      const resolved = { assignments: new Map<string, string>(), categories: [] }
      this.dependencies.repositories.settings.set(TOPIC_ASSIGNMENTS_KEY, {
        assignments: {},
        categories: resolved.categories,
        signature
      } satisfies PersistedTopicAssignments)
      return resolved
    }

    if (useSelectedEngine && this.dependencies.clusterTopics && evidence.length > 0) {
      const preferredCategoryNames = previous?.categories ?? []
      // A cache hit already reuses this same output; prior names only guide a new content classification.
      if (previous?.signature === signature) {
        return {
          assignments: new Map(Object.entries(previous.assignments)),
          categories: previous.categories
        }
      }
      let resolved: TopicAssignmentSet
      try {
        const clustered = await this.dependencies.clusterTopics(evidence, preferredCategoryNames)
        resolved = assignmentsFromCluster(evidence, clustered)
      } catch {
        this.log('飞书选题大类归并失败，已沿用上次分类并补充本地分类', {
          code: 'FEISHU_TOPIC_CLUSTERING_FAILED'
        })
        return fallbackTopicAssignments(evidence, previous)
      }
      this.dependencies.repositories.settings.set(TOPIC_ASSIGNMENTS_KEY, {
        assignments: Object.fromEntries(resolved.assignments),
        categories: resolved.categories,
        signature
      } satisfies PersistedTopicAssignments)
      return resolved
    }

    return fallbackTopicAssignments(evidence, previous)
  }

  private topicEvidence(work: Work): TopicEvidenceWork {
    const analysis = this.dependencies.repositories.analyses.get(work.id)
    const result = analysis?.result ?? {}
    const taxonomy = workTaxonomy(work, result, analysis?.transcript)
    return {
      id: work.id,
      title: work.title,
      category: taxonomy.category,
      keywords: taxonomy.keywords.split('、').filter(Boolean),
      topicAngle: stringValue(result.topicAngle) ?? '',
      viralPoints: Array.isArray(result.viralPoints)
        ? result.viralPoints.filter((value): value is string => typeof value === 'string')
        : []
    }
  }

  private async syncBatch(
    service: FeishuSyncService,
    base: ProvisionedBase,
    table: FeishuTableKey,
    identityField: string,
    items: FeishuUpsertItem[]
  ): Promise<void> {
    const mappings = await service.upsertMany(base, table, identityField, items)
    for (const mapping of mappings) {
      this.dependencies.repositories.feishu.saveRecordMapping({
        tableKey: table,
        ...mapping,
        firstSyncedAt: table === 'works' ? this.now().toISOString() : null
      })
    }
  }

  private async syncManagedSummaries(
    service: FeishuSyncService,
    base: ProvisionedBase,
    currentWorks: Work[],
    now: Date,
    topicAssignments: Map<string, string> = new Map(),
    refreshSemanticSummaries = true
  ): Promise<void> {
    const syncedWorks = currentWorks.filter((work) => (
      this.dependencies.repositories.feishu.getRecordMapping('works', work.id)
    ))
    const currentIds = new Set(syncedWorks.map((work) => work.id))
    const snapshots = this.dependencies.repositories.snapshots.list()
      .filter((snapshot) => currentIds.has(snapshot.workId))
    const summaryWorks = syncedWorks.map((work) => this.summaryWork(work, topicAssignments.get(work.id)))

    const growthItems = buildGrowthTop10(summaryWorks, snapshots, now).map((row) => ({
      localId: row.id,
      identityValue: row.id,
      fields: logicalFields(base, 'growthTop10', {
        rank: row.rank,
        title: row.title,
        creatorName: row.creatorName,
        growthRate: row.growthRate,
        engagementGrowth: row.engagementGrowth,
        latestEngagement: row.latestEngagement,
        shortTitle: row.shortTitle,
        originalUrl: row.originalUrl
          ? urlFieldValue(base, 'growthTop10', 'originalUrl', row.originalUrl)
          : undefined
      })
    }))
    await this.replaceManagedRows(
      service,
      base,
      'growthTop10',
      fieldName(base, 'growthTop10', 'rankingId', '榜单ID'),
      ['growth-top-'],
      growthItems
    )

    const directionItems = buildCreativeDirections(summaryWorks, snapshots, now).map((row) => ({
      localId: row.id,
      identityValue: `方向：${row.direction}`,
      fields: logicalFields(base, 'directions', {
        direction: row.direction,
        workCount: row.workCount,
        averageEngagement: row.averageEngagement,
        sevenDayGrowth: row.sevenDayGrowth,
        keywords: row.keywords,
        representativeWork: row.representativeWork,
        recommendation: row.recommendation
      })
    }))
    await this.replaceManagedRows(
      service,
      base,
      'directions',
      fieldName(base, 'directions', 'directionId', '方向ID'),
      ['direction:', '方向：'],
      directionItems,
      true
    )

    const termEvidence = summaryWorks.map((item) => ({
      id: item.work.id,
      title: item.work.title,
      candidates: extractTitlePhraseCandidates(item.work.title)
    }))
    const signature = termEvidence
      .map((work) => JSON.stringify(work))
      .sort()
      .join('|')
    const persisted = this.dependencies.repositories.settings
      .get<PersistedContentTermClusters>(CONTENT_TERM_CLUSTERS_KEY)
    let termClusters: ContentTermClusterResult | null = null
    if (!refreshSemanticSummaries) {
      termClusters = null
    } else if (termEvidence.length === 0) {
      termClusters = { terms: [] }
    } else if (persisted?.signature === signature && persisted.result.terms.length > 0) {
      termClusters = persisted.result
    } else if (this.dependencies.clusterContentTerms) {
      let clustered: ContentTermClusterResult | null = null
      try {
        clustered = await this.dependencies.clusterContentTerms(termEvidence)
      } catch {
        this.log('飞书热门内容词复核失败，已保留上次同步结果', {
          code: 'FEISHU_CONTENT_TERM_CLUSTERING_FAILED'
        })
      }
      if (clustered?.terms.length) {
        termClusters = clustered
        this.dependencies.repositories.settings.set(CONTENT_TERM_CLUSTERS_KEY, {
          signature,
          result: termClusters
        } satisfies PersistedContentTermClusters)
      } else if (clustered) {
        this.log('飞书热门内容词复核未产生有效词条，已保留上次同步结果', {
          code: 'FEISHU_CONTENT_TERMS_EMPTY'
        })
      }
    }
    if (!termClusters) return
    const contentTermItems = buildHotContentTerms(summaryWorks, termClusters).map((row) => ({
      localId: row.id,
      identityValue: row.id,
      fields: logicalFields(base, 'contentTerms', {
        term: row.term,
        workCount: row.workCount,
        totalEngagement: row.totalEngagement,
        averageEngagement: row.averageEngagement,
        representativeWork: row.representativeWork
      })
    }))
    await this.replaceManagedRows(
      service,
      base,
      'contentTerms',
      fieldName(base, 'contentTerms', 'termId', '词条ID'),
      ['term:'],
      contentTermItems
    )
  }

  private async replaceManagedRows(
    service: FeishuSyncService,
    base: ProvisionedBase,
    table: 'growthTop10' | 'directions' | 'contentTerms',
    identityField: string,
    managedPrefixes: readonly string[],
    items: FeishuUpsertItem[],
    removeLegacyReports = false
  ): Promise<void> {
    const mappings = await service.upsertMany(base, table, identityField, items)
    for (const mapping of mappings) {
      this.dependencies.repositories.feishu.saveRecordMapping({ tableKey: table, ...mapping })
    }

    const desired = new Set(items.map((item) => item.identityValue))
    const remote = await service.api.listRecords(base.appToken, base.tables[table])
    for (const record of remote) {
      const identity = record.fields[identityField]
      const managedIdentity = typeof identity === 'string' && managedPrefixes.some((prefix) => identity.startsWith(prefix))
      const legacyReport = removeLegacyReports && typeof record.fields['报告ID'] === 'string'
        && Boolean(String(record.fields['报告ID']).trim())
      if ((!managedIdentity || desired.has(identity as string)) && !legacyReport) continue
      await service.api.deleteRecord(base.appToken, base.tables[table], record.recordId)
      if (managedIdentity) {
        const desiredItem = items.find((item) => item.identityValue === identity)
        this.dependencies.repositories.feishu.deleteRecordMapping(table, desiredItem?.localId ?? identity as string)
      }
    }
  }

  private summaryWork(work: Work, broadCategory?: string): FeishuSummaryWork {
    const analysis = this.dependencies.repositories.analyses.get(work.id)
    const taxonomy = workTaxonomy(work, analysis?.result ?? {}, analysis?.transcript)
    const creator = work.creatorId
      ? this.dependencies.repositories.creators.getById(work.creatorId)
      : null
    return {
      work,
      creatorName: creator?.name ?? '未分类作品',
      category: broadCategory ?? taxonomy.category,
      keywords: taxonomy.keywords
    }
  }

  private async syncCreator(
    service: FeishuSyncService,
    base: ProvisionedBase,
    creator: ReturnType<AppRepositories['creators']['getById']> & {}
  ): Promise<void> {
    if (!creator) return
    const item = this.creatorItem(base, creator)
    const recordId = await service.upsert(
      base,
      'creators',
      fieldName(base, 'creators', 'creatorId', '博主ID'),
      item.identityValue,
      item.fields,
      this.dependencies.repositories.feishu.getRecordMapping('creators', item.localId)
    )
    this.dependencies.repositories.feishu.saveRecordMapping({ tableKey: 'creators', localId: item.localId, recordId })
  }

  private async syncOneWork(
    service: FeishuSyncService,
    base: ProvisionedBase,
    work: Work,
    table: 'works' | 'worksArchive' = 'works',
    decision?: WorkDecision,
    broadCategory?: string
  ): Promise<void> {
    const item = this.workItem(base, work, table, decision, broadCategory)
    const recordId = await service.upsert(
      base,
      table,
      fieldName(base, table, 'workId', '作品ID'),
      item.identityValue,
      item.fields,
      this.dependencies.repositories.feishu.getRecordMapping(table, item.localId)
    )
    this.dependencies.repositories.feishu.saveRecordMapping({
      tableKey: table,
      localId: item.localId,
      recordId,
      firstSyncedAt: table === 'works' ? this.now().toISOString() : null
    })
  }

  private creatorItem(
    base: ProvisionedBase,
    creator: ReturnType<AppRepositories['creators']['getById']> & {}
  ): FeishuUpsertItem {
    return {
      localId: creator.id,
      identityValue: creator.id,
      fields: logicalFields(base, 'creators', {
        name: creator.name,
        accountType: creator.ownership === 'mine' ? '我的账号' : '对标账号',
        profileUrl: urlFieldValue(base, 'creators', 'profileUrl', creator.profileUrl),
        enabled: creator.enabled
      })
    }
  }

  private isPublishedWithinDays(work: Work, days: number, now: Date): boolean {
    const publishedAt = Date.parse(work.publishedAt)
    if (!Number.isFinite(publishedAt)) return false
    const age = now.getTime() - publishedAt
    return age >= 0 && age <= days * 24 * 60 * 60 * 1000
  }

  private retentionDays(): number {
    const value = this.dependencies.repositories.settings.get<PublicSettings>('app.publicSettings')?.feishuRetentionDays
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 30
  }

  private syncRecentDays(): number {
    const value = this.dependencies.repositories.settings.get<PublicSettings>('app.publicSettings')?.feishuSyncRecentDays
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : 30
  }

  private initializeLegacyFirstSyncTimes(works: Work[], now: Date): void {
    for (const work of works) {
      const mapping = this.dependencies.repositories.feishu.getRecordMappingRecord('works', work.id)
      if (!mapping || mapping.firstSyncedAt) continue
      this.dependencies.repositories.feishu.saveRecordMapping({
        tableKey: 'works',
        localId: work.id,
        recordId: mapping.recordId,
        firstSyncedAt: now.toISOString()
      })
    }
  }

  private highlightThresholds(): HighlightThresholdOverrides {
    const settings = this.dependencies.repositories.settings.get<PublicSettings>('app.publicSettings')
    return {
      absoluteLikes: settings?.absoluteLikes,
      highCollects: settings?.highCollects,
      highComments: settings?.highComments,
      highShares: settings?.highShares,
      relativePerformanceSurgeMultiplier: settings?.relativePerformanceSurgeMultiplier,
      relativePerformanceMultiplier: settings?.relativePerformanceMultiplier
    }
  }

  private workDecisions(works: Work[], now: Date): Map<string, WorkDecision> {
    const syncRecentDays = this.syncRecentDays()
    const retentionDays = this.retentionDays()
    const thresholds = this.highlightThresholds()
    const groups = new Map<string | null, Work[]>()
    for (const work of works) {
      const key = work.creatorId
      const group = groups.get(key) ?? []
      group.push(work)
      groups.set(key, group)
    }
    const decisions = new Map<string, WorkDecision>()
    for (const group of groups.values()) {
      const candidates = group.slice(0, 31)
      for (const work of group) {
        const baseline = candidates
          .filter((candidate) => candidate.id !== work.id)
          .slice(0, 30)
          .map((candidate) => calculateEngagement(candidate.metrics))
        const highlight = evaluateHighlight(work.metrics, baseline, thresholds)
        const mapping = this.dependencies.repositories.feishu.getRecordMappingRecord('works', work.id)
        const retentionExpired = mapping?.firstSyncedAt
          ? isOlderThanDays(mapping.firstSyncedAt, retentionDays, now)
          : false
        const eligible = work.ownership === 'mine' || highlight.isHighlight
        decisions.set(work.id, {
          current: eligible && (mapping
            ? !retentionExpired
            : this.isPublishedWithinDays(work, syncRecentDays, now)),
          expired: Boolean(mapping && retentionExpired),
          highlight
        })
      }
    }
    return decisions
  }

  private async reconcileOrphanedMappings(
    service: FeishuSyncService,
    base: ProvisionedBase,
    localIds: { creatorIds: Set<string>; workIds: Set<string>; snapshotIds: Set<string> }
  ): Promise<void> {
    const tables = [
      ['snapshots', localIds.snapshotIds],
      ['works', localIds.workIds],
      ['worksArchive', localIds.workIds],
      ['creators', localIds.creatorIds]
    ] as const

    for (const [table, ids] of tables) {
      for (const mapping of this.dependencies.repositories.feishu.listRecordMappings(table)) {
        if (ids.has(mapping.localId)) continue
        try {
          await service.api.deleteRecord(base.appToken, base.tables[table], mapping.recordId)
        } catch (error) {
          if (!String(error).includes('FEISHU_API_1254043')) throw error
        }
        this.dependencies.repositories.feishu.deleteRecordMapping(table, mapping.localId)
      }
    }
  }

  private async removeCurrentWork(service: FeishuSyncService, base: ProvisionedBase, work: Work): Promise<void> {
    await this.deleteMappedRecord(service, base, 'works', work.id)
    for (const snapshot of this.dependencies.repositories.snapshots.listByWork(work.id)) {
      await this.deleteMappedRecord(service, base, 'snapshots', snapshotIdentity(snapshot.workId, snapshot.capturedAt))
    }
  }

  private async reconcileMappedWorks(
    service: FeishuSyncService,
    base: ProvisionedBase,
    works: Work[],
    decisions: Map<string, WorkDecision>
  ): Promise<void> {
    for (const work of works) {
      if (!this.dependencies.repositories.feishu.getRecordMapping('works', work.id)) continue
      const decision = decisions.get(work.id)
      if (!decision || decision.current) continue
      if (decision.expired) {
        const creator = work.creatorId ? this.dependencies.repositories.creators.getById(work.creatorId) : null
        if (creator) await this.syncCreator(service, base, creator)
        await this.syncOneWork(service, base, work, 'worksArchive', decision)
      }
      await this.removeCurrentWork(service, base, work)
    }
  }

  private async deleteMappedRecord(
    service: FeishuSyncService,
    base: ProvisionedBase,
    table: 'works' | 'snapshots',
    localId: string
  ): Promise<void> {
    const recordId = this.dependencies.repositories.feishu.getRecordMapping(table, localId)
    if (!recordId) return
    try {
      await service.api.deleteRecord(base.appToken, base.tables[table], recordId)
    } catch (error) {
      if (!String(error).includes('FEISHU_API_1254043')) throw error
    }
    this.dependencies.repositories.feishu.deleteRecordMapping(table, localId)
  }

  private workItem(
    base: ProvisionedBase,
    work: Work,
    table: 'works' | 'worksArchive' = 'works',
    decision?: WorkDecision,
    broadCategory?: string
  ): FeishuUpsertItem {
    const highlight = decision?.highlight ?? evaluateHighlight(work.metrics, [], this.highlightThresholds())
    const analysis = this.dependencies.repositories.analyses.get(work.id)
    const result = analysis?.result ?? {}
    const creator = work.creatorId
      ? this.dependencies.repositories.creators.getById(work.creatorId)
      : null
    const taxonomy = workTaxonomy(work, result, analysis?.transcript)
    const creatorRecordId = work.creatorId
      ? this.dependencies.repositories.feishu.getRecordMapping('creators', work.creatorId)
      : null
    return {
      localId: work.id,
      identityValue: work.id,
      fields: logicalFields(base, table, {
        ownership: work.ownership === 'mine' ? '我的作品' : '对标作品',
        accountType: work.ownership === 'mine' ? '我的账号' : '对标账号',
        sourceType: sourceLabel(work.sourceType),
        creator: creatorRecordId ? [creatorRecordId] : undefined,
        creatorName: creator?.name ?? '未分类作品',
        title: work.title,
        publishedAt: dateValue(work.publishedAt),
        originalUrl: work.originalUrl ? urlFieldValue(base, table, 'originalUrl', work.originalUrl) : undefined,
        likes: work.metrics.likes,
        comments: work.metrics.comments,
        shares: work.metrics.shares,
        collects: work.metrics.collects,
        relativePerformance: highlight.relativePerformanceMultiplier ?? undefined,
        highlightReasons: highlight.reasons.map(reasonLabel).join('、'),
        topicCategory: broadCategory ?? taxonomy.category,
        contentKeywords: taxonomy.keywords,
        topicAngle: stringValue(result.topicAngle),
        openingHook: objectText(result.openingHook),
        contentStructure: listText(result.structure),
        viralPoint: listText(result.viralPoints),
        highlights: listText(result.highlights),
        reusablePattern: listText(result.reusablePatterns),
        differentiation: objectText(result.differentiatedSuggestions),
        transcript: analysis?.transcript,
        provider: analysis?.provider,
        model: analysis?.model,
        promptVersion: analysis?.promptVersion
      })
    }
  }

  private async syncSnapshot(
    service: FeishuSyncService,
    base: ProvisionedBase,
    snapshot: MetricSnapshotRecord
  ): Promise<void> {
    const item = this.snapshotItem(base, snapshot)
    const recordId = await service.upsert(
      base,
      'snapshots',
      fieldName(base, 'snapshots', 'snapshotId', '快照ID'),
      item.identityValue,
      item.fields,
      this.dependencies.repositories.feishu.getRecordMapping('snapshots', item.localId)
    )
    this.dependencies.repositories.feishu.saveRecordMapping({ tableKey: 'snapshots', localId: item.localId, recordId })
  }

  private snapshotItem(base: ProvisionedBase, snapshot: MetricSnapshotRecord): FeishuUpsertItem {
    const id = snapshotIdentity(snapshot.workId, snapshot.capturedAt)
    const workRecordId = this.dependencies.repositories.feishu.getRecordMapping('works', snapshot.workId)
    return {
      localId: id,
      identityValue: id,
      fields: logicalFields(base, 'snapshots', {
        work: workRecordId ? [workRecordId] : undefined,
        capturedAt: dateValue(snapshot.capturedAt),
        likes: snapshot.metrics.likes,
        comments: snapshot.metrics.comments,
        shares: snapshot.metrics.shares,
        collects: snapshot.metrics.collects
      })
    }
  }

  private readCustomCredentials(): FeishuCustomAppCredentials | null {
    const raw = this.dependencies.credentials.get(CUSTOM_APP_KEY)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as Partial<FeishuCustomAppCredentials>
      if (typeof value.appId !== 'string' || typeof value.appSecret !== 'string') return null
      if (!value.appId.trim() || !value.appSecret.trim()) return null
      return { appId: value.appId.trim(), appSecret: value.appSecret.trim() }
    } catch {
      return null
    }
  }

  private saveBase(base: ProvisionedBase): void {
    const previous = this.dependencies.repositories.feishu.getBinding()
    if (previous && previous.appToken !== base.appToken) {
      this.dependencies.repositories.feishu.clear()
    }
    this.dependencies.repositories.feishu.saveBinding({
      appToken: base.appToken,
      baseName: '对标内容雷达',
      baseUrl: base.url,
      schemaVersion: base.schemaVersion,
      status: 'connected',
      lastSyncedAt: previous?.appToken === base.appToken ? previous.lastSyncedAt : null,
      errorMessage: null
    })
    this.dependencies.repositories.feishu.removeTableNamespace('reports')
    for (const [tableKey, tableId] of Object.entries(base.tables)) {
      this.dependencies.repositories.feishu.saveTable({ tableKey, tableId })
    }
    for (const [tableKey, fields] of Object.entries(base.fields ?? {})) {
      for (const [fieldKey, field] of Object.entries(fields ?? {})) {
        this.dependencies.repositories.feishu.saveField({
          tableKey,
          fieldKey,
          fieldId: field.fieldId,
          fieldName: field.name,
          fieldType: field.type
        })
      }
    }
  }

  private knownFields(): NonNullable<ProvisionedBase['fields']> {
    const known: NonNullable<ProvisionedBase['fields']> = {}
    for (const tableKey of ['creators', 'works', 'worksArchive', 'snapshots', 'growthTop10', 'directions', 'contentTerms'] as const) {
      known[tableKey] = Object.fromEntries(
        this.dependencies.repositories.feishu.getFields(tableKey)
          .map((field) => [field.fieldKey, {
            fieldId: field.fieldId,
            name: field.fieldName,
            type: field.fieldType as import('./schema').FeishuFieldType
          }])
      )
    }
    return known
  }

  private markConnected(binding: NonNullable<ReturnType<AppRepositories['feishu']['getBinding']>>): void {
    this.dependencies.repositories.feishu.saveBinding({
      ...binding,
      status: 'connected',
      lastSyncedAt: this.now().toISOString(),
      errorMessage: null
    })
  }

  private saveFailure(error: unknown): void {
    const binding = this.dependencies.repositories.feishu.getBinding()
    if (!binding) return
    const needsRepair = error instanceof FeishuSchemaError || error instanceof FeishuBaseMissingError
    this.dependencies.repositories.feishu.saveBinding({
      ...binding,
      status: needsRepair ? 'needs_repair' : 'sync_error',
      errorMessage: userMessage(error)
    })
  }
}

function view(
  status: FeishuConnectionStatus,
  binding: ReturnType<AppRepositories['feishu']['getBinding']>,
  message: string,
  credentials: FeishuCustomAppCredentials | null,
  candidates?: Array<{ appToken: string; url: string }>
): FeishuConnectionView {
  return {
    status,
    baseName: binding?.baseName ?? null,
    baseUrl: binding?.baseUrl ?? null,
    lastSyncedAt: binding?.lastSyncedAt ?? null,
    message,
    customAppConfigured: Boolean(credentials),
    maskedAppId: credentials ? maskAppId(credentials.appId) : null,
    ...(candidates?.length ? { candidates } : {})
  }
}

function statusMessage(status: FeishuConnectionStatus): string {
  if (status === 'provisioning') return '正在检查飞书应用权限和表格结构'
  if (status === 'syncing_data') return '表格已就绪，正在批量同步本地数据'
  return ''
}

function userMessage(error: unknown): string {
  const userError = toFeishuUserError(error)
  return `${userError.title}（${userError.code}）`
}

function actionableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('wiki.node')) {
    const stableCode = /^(FEISHU_(?:API_\d+|HTTP_\d+|INVALID_RESPONSE))\b/.exec(message)?.[1]
    return new Error(stableCode ?? 'FEISHU_WIKI_NODE_INVALID_RESPONSE')
  }
  if (message.includes('FEISHU_CUSTOM_APP_CREDENTIALS_INVALID')) {
    return new Error('应用凭证无效，请在飞书开放平台重新复制')
  }
  if (message.includes('FEISHU_CUSTOM_APP_ID_INVALID')) {
    return new Error('App ID 格式不正确，请重新复制')
  }
  if (message.includes('FEISHU_CUSTOM_APP_SECRET_REQUIRED')) {
    return new Error('请输入 App Secret')
  }
  if (message.includes('FEISHU_BASE_URL_INVALID')) {
    return new Error('请粘贴包含 /base/ 的飞书多维表格链接')
  }
  if (
    message.includes('FEISHU_API_91403')
    || message.includes('FEISHU_API_1254302')
    || message.includes('FEISHU_API_1254304')
  ) {
    const stableCode = /\b(FEISHU_API_(?:91403|1254302|1254304))\b/u.exec(message)?.[1]
    return new Error(stableCode ?? 'FEISHU_PERMISSION_DENIED')
  }
  if (message.includes('FEISHU_API_99991672')) {
    return new Error('FEISHU_API_99991672')
  }
  return error instanceof Error ? error : new Error('飞书同步失败，请稍后重试')
}

function maskAppId(appId: string): string {
  if (appId.length <= 8) return `${appId.slice(0, 4)}***`
  return `${appId.slice(0, 4)}***${appId.slice(-4)}`
}

function dateValue(value: string): number {
  return Date.parse(value)
}

function isOlderThanDays(value: string, days: number, now: Date): boolean {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return now.getTime() - timestamp > days * 24 * 60 * 60 * 1000
}

function urlValue(value: string): { link: string; text: string } {
  return { link: value, text: value }
}

function urlFieldValue(
  base: ProvisionedBase,
  table: FeishuTableKey,
  key: string,
  value: string
): string | { link: string; text: string } {
  return base.fields?.[table]?.[key]?.type === 'text' ? value : urlValue(value)
}

function workTaxonomy(
  work: Work,
  result: Record<string, unknown>,
  transcript?: string | null
): { category: string; keywords: string } {
  const declaredCategory = stringValue(result.topicCategory) ?? ''
  const hashtags = Array.from(work.title.matchAll(/#([\p{L}\p{N}_-]{2,20})/gu), (match) => match[1] ?? '')
  const genericCategories = new Set(['ai', '内容', '工具', '教程', '其他', '未分类'])
  const isSpecific = (value: string): boolean => {
    const normalized = value.trim().toLocaleLowerCase('zh-CN')
    return Boolean(normalized) && !genericCategories.has(normalized) && !isWeakKeyword(normalized)
  }
  const structuredKeywords = Array.isArray(result.contentKeywords)
    ? result.contentKeywords.filter((value): value is string => typeof value === 'string')
    : []
  const category = isSpecific(declaredCategory)
    ? declaredCategory.trim()
    : hashtags.find(isSpecific)?.trim() ?? '未分类'
  const candidates = (structuredKeywords.length > 0 ? structuredKeywords : hashtags)
    .map((value) => value.trim())
    .filter((value) => isSpecific(value) && value.toLocaleLowerCase('zh-CN') !== category.toLocaleLowerCase('zh-CN'))
  return {
    category,
    keywords: uniqueStrings(candidates).slice(0, 3).join('、')
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = value.trim()
    const key = normalized.toLocaleLowerCase('zh-CN')
    if (!normalized || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function logicalFields(
  base: ProvisionedBase,
  table: FeishuTableKey,
  fields: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [fieldName(base, table, key, key), value])
  )
}

function fieldName(
  base: ProvisionedBase,
  table: FeishuTableKey,
  key: string,
  fallback: string
): string {
  return base.fields?.[table]?.[key]?.name
    ?? FEISHU_BASE_SCHEMA.tables.find((definition) => definition.key === table)
      ?.fields.find((field) => field.key === key)?.name
    ?? fallback
}

function sourceLabel(source: Work['sourceType']): string {
  if (source === 'local_file') return '本地视频'
  if (source === 'douyin_url') return '抖音链接'
  return '自动监控'
}

function reasonLabel(reason: HighlightReason): string {
  switch (reason) {
    case 'absolute_high_likes': return '绝对高点赞'
    case 'high_collects': return '高收藏'
    case 'high_comments': return '高评论'
    case 'high_shares': return '高转发'
    case 'relative_performance_surge': return '相对表现暴增'
    case 'relative_performance': return '相对表现突出'
    default: return String(reason)
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function listText(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(String).join('\n') : undefined
}

function objectText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const labels: Record<string, string> = {
    quote: '原句',
    type: '类型',
    mechanism: '机制',
    angles: '角度建议',
    titles: '标题建议',
    openings: '开头建议',
    risks: '风险提示'
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${labels[key] ?? key}：${Array.isArray(item) ? item.join('、') : String(item)}`)
    .join('\n')
}

function resolveWikiBitableToken(api: FeishuConnectionApi, nodeToken: string): Promise<string> {
  return api.resolveWikiNode(nodeToken).then((node) => {
    if (node.objType !== 'bitable') throw new Error('FEISHU_WIKI_NOT_BITABLE')
    if (!/^[A-Za-z0-9_-]+$/.test(node.objToken)) {
      throw new Error('FEISHU_WIKI_NODE_INVALID_RESPONSE')
    }
    return node.objToken
  })
}

function normalizedBaseUrl(value: string, appToken: string): string {
  try {
    const input = new URL(value.trim())
    const query = new URLSearchParams()
    for (const key of ['table', 'view']) {
      const queryValue = input.searchParams.get(key)
      if (queryValue && /^[A-Za-z0-9_-]+$/.test(queryValue)) query.set(key, queryValue)
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return `${input.origin}/base/${appToken}${suffix}`
  } catch {
    return `https://feishu.cn/base/${appToken}`
  }
}

export function snapshotIdentity(workId: string, capturedAt: string): string {
  return `${workId}:${chinaDateKey(capturedAt)}`
}

function latestDailySnapshots(snapshots: MetricSnapshotRecord[]): MetricSnapshotRecord[] {
  const latest = new Map<string, MetricSnapshotRecord>()
  for (const snapshot of snapshots) {
    const identity = snapshotIdentity(snapshot.workId, snapshot.capturedAt)
    const current = latest.get(identity)
    if (!current || snapshot.capturedAt > current.capturedAt) latest.set(identity, snapshot)
  }
  return [...latest.values()]
}

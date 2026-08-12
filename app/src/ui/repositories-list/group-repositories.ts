import {
  Repository,
  ILocalRepositoryState,
  nameOf,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { getHTMLURL } from '../../lib/api'
import { caseInsensitiveCompare, compare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { assertNever } from '../../lib/fatal-error'
import { isDotCom } from '../../lib/endpoint-capabilities'
import { Owner } from '../../models/owner'
import { SubmoduleEntry } from '../../models/submodule'
import { matchExistingRepository } from '../../lib/repository-matching'
import * as Path from 'path'

export type RepositoryListGroup =
  | {
      kind: 'recent' | 'other'
    }
  | {
      kind: 'dotcom'
      owner: Owner
    }
  | {
      kind: 'enterprise'
      host: string
    }

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  const { kind } = group
  switch (kind) {
    case 'recent':
      return `0:recent`
    case 'dotcom':
      return `1:dotcom:${group.owner.login}`
    case 'enterprise':
      return `2:enterprise:${group.host}`
    case 'other':
      return `3:other`
    default:
      assertNever(group, `Unknown repository group kind ${kind}`)
  }
}
export type Repositoryish = Repository | CloningRepository

export interface IRepositoryListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  /**
   * The repository this item represents, or null for a submodule which hasn't
   * been opened (and thereby added to the list of repositories) yet.
   */
  readonly repository: Repositoryish | null
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
  /** Set when this item is a submodule of the repository listed above it */
  readonly submodule?: ISubmoduleListItemData
}

/** The submodule details of a repository list item */
export interface ISubmoduleListItemData {
  /** The repository the submodule belongs to */
  readonly parent: Repository
  readonly entry: SubmoduleEntry
}

/**
 * Inserts the submodules of the expanded repositories into the given groups,
 * directly below the repository they belong to.
 */
export function insertSubmoduleItems(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  submodules: ReadonlyMap<number, ReadonlyArray<SubmoduleEntry>>,
  expandedRepositoryIds: ReadonlySet<number>,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  return groups.map(group => ({
    identifier: group.identifier,
    items: group.items.flatMap(item => {
      const { repository } = item

      if (
        !(repository instanceof Repository) ||
        !expandedRepositoryIds.has(repository.id)
      ) {
        return [item]
      }

      const entries = submodules.get(repository.id) ?? []

      return [
        item,
        ...entries.map(entry =>
          createSubmoduleItem(
            repository,
            entry,
            getGroupKey(group.identifier),
            repositories,
            localRepositoryStateLookup
          )
        ),
      ]
    }),
  }))
}

function createSubmoduleItem(
  parent: Repository,
  entry: SubmoduleEntry,
  groupKey: string,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): IRepositoryListItem {
  const repository = matchExistingRepository(
    repositories.filter((r): r is Repository => r instanceof Repository),
    submodulePath(parent, entry)
  )

  const repoState = repository && localRepositoryStateLookup.get(repository.id)

  return {
    // Prefixed with the group key since the same submodule can show up
    // in both the `Recent` group and the group of its parent repository.
    id: `submodule/${groupKey}/${parent.id}/${entry.path}`,
    text: [entry.path],
    repository: repository ?? null,
    needsDisambiguation: false,
    aheadBehind: repoState?.aheadBehind ?? null,
    changedFilesCount: repoState?.changedFilesCount ?? 0,
    submodule: { parent, entry },
  }
}

/** The absolute path to the working directory of the given submodule */
export function submodulePath(parent: Repository, entry: SubmoduleEntry) {
  return Path.resolve(parent.path, entry.path)
}

/** Normalizes a path for comparison with other paths */
export const normalizePath = (path: string) =>
  __WIN32__ ? Path.normalize(path).toLowerCase() : Path.normalize(path)

const recentRepositoriesThreshold = 7

const getHostForRepository = (repo: RepositoryWithGitHubRepository) =>
  new URL(getHTMLURL(repo.gitHubRepository.endpoint)).host

const getGroupForRepository = (repo: Repositoryish): RepositoryListGroup => {
  if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
    return isDotCom(repo.gitHubRepository.endpoint)
      ? { kind: 'dotcom', owner: repo.gitHubRepository.owner }
      : { kind: 'enterprise', host: getHostForRepository(repo) }
  }
  return { kind: 'other' }
}

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  recentRepositories: ReadonlyArray<number>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const includeRecentGroup = repositories.length > recentRepositoriesThreshold
  const recentSet = includeRecentGroup ? new Set(recentRepositories) : undefined
  const groups = new Map<string, RepoGroupItem>()

  const addToGroup = (group: RepositoryListGroup, repo: Repositoryish) => {
    const key = getGroupKey(group)
    let rg = groups.get(key)
    if (!rg) {
      rg = { group, repos: [] }
      groups.set(key, rg)
    }

    rg.repos.push(repo)
  }

  for (const repo of repositories) {
    if (recentSet?.has(repo.id) && repo instanceof Repository) {
      addToGroup({ kind: 'recent' }, repo)
    }

    addToGroup(getGroupForRepository(repo), repo)
  }

  return Array.from(groups)
    .sort(([xKey], [yKey]) => compare(xKey, yKey))
    .map(([, { group, repos }]) => ({
      identifier: group,
      items: toSortedListItems(
        group,
        repos,
        localRepositoryStateLookup,
        groups
      ),
    }))
}

// Returns the display title for a repository, which is either the alias
// (if available) or the name.
const getDisplayTitle = (r: Repositoryish) =>
  r instanceof Repository && r.alias != null ? r.alias : r.name

const toSortedListItems = (
  group: RepositoryListGroup,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  groups: Map<string, RepoGroupItem>
): IRepositoryListItem[] => {
  const groupNames = new Map<string, number>()
  const allNames = new Map<string, number>()

  for (const groupItem of groups.values()) {
    // All items in the recent group are by definition present in another
    // group and therefore we don't want to count them.
    if (groupItem.group.kind === 'recent') {
      continue
    }

    for (const title of groupItem.repos.map(getDisplayTitle)) {
      allNames.set(title, (allNames.get(title) ?? 0) + 1)
      if (groupItem.group === group) {
        groupNames.set(title, (groupNames.get(title) ?? 0) + 1)
      }
    }
  }

  return repositories
    .map(r => {
      const repoState = localRepositoryStateLookup.get(r.id)
      const title = getDisplayTitle(r)

      return {
        text: r instanceof Repository ? [title, nameOf(r)] : [title],
        id: r.id.toString(),
        repository: r,
        needsDisambiguation:
          // If the repository is in the enterprise group and has a duplicate
          // name in the group, we need to disambiguate it. We don't have to
          // disambiguate repositories in the 'dotcom' group because they are
          // already grouped by owner. If the repository is in the 'recent'
          // group and has a duplicate name in any group, we need to
          // disambiguate it.
          ((groupNames.get(title) ?? 0) > 1 && group.kind === 'enterprise') ||
          ((allNames.get(title) ?? 0) > 1 && group.kind === 'recent'),
        aheadBehind: repoState?.aheadBehind ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}

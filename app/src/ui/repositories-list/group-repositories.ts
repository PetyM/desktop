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
import { normalizePath } from '../../lib/path'
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
  /** The branch currently checked out in the repository, when known */
  readonly branchName: string | null
  /** Set when this item is a submodule of the repository listed above it */
  readonly submodule?: ISubmoduleListItemData
}

/** The submodule details of a repository list item */
export interface ISubmoduleListItemData {
  /** The path of the repository or submodule the submodule belongs to */
  readonly parentPath: string

  /** The absolute path of the submodule's working directory */
  readonly path: string

  readonly entry: SubmoduleEntry

  /** How many submodules deep this submodule is nested, starting at zero */
  readonly depth: number

  /** The number of submodules of this submodule, as far as we know */
  readonly submoduleCount: number
}

/**
 * Inserts the submodules of the repositories (and the submodules of those
 * submodules, and so on) into the given groups, directly below the repository
 * or submodule they belong to.
 *
 * Everything is expanded unless the user has collapsed it.
 *
 * @param submodules      The submodules of each repository and submodule we've
 *                        looked at so far, keyed by normalized path
 * @param collapsedPaths  The normalized paths of the repositories and
 *                        submodules whose submodules should be hidden
 */
export function insertSubmoduleItems(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  submodules: ReadonlyMap<string, ReadonlyArray<SubmoduleEntry>>,
  collapsedPaths: ReadonlySet<string>,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const knownRepositories = repositories.filter(
    (r): r is Repository => r instanceof Repository
  )

  const createItems = (
    parentPath: string,
    groupKey: string,
    depth: number
  ): ReadonlyArray<IRepositoryListItem> =>
    (submodules.get(normalizePath(parentPath)) ?? []).flatMap(entry => {
      const path = Path.resolve(parentPath, entry.path)
      const repository = matchExistingRepository(knownRepositories, path)

      const repoState =
        repository && localRepositoryStateLookup.get(repository.id)

      const item: IRepositoryListItem = {
        // Prefixed with the group key since the same submodule can show up in
        // both the `Recent` group and the group of its parent repository.
        id: `submodule/${groupKey}/${path}`,
        text: [entry.path],
        repository: repository ?? null,
        needsDisambiguation: false,
        aheadBehind: repoState?.aheadBehind ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
        branchName: repoState?.branchName ?? null,
        submodule: {
          parentPath,
          path,
          entry,
          depth,
          submoduleCount: (submodules.get(normalizePath(path)) ?? []).length,
        },
      }

      return collapsedPaths.has(normalizePath(path))
        ? [item]
        : [item, ...createItems(path, groupKey, depth + 1)]
    })

  return groups.map(group => ({
    identifier: group.identifier,
    items: group.items.flatMap(item => {
      const { repository } = item

      if (
        !(repository instanceof Repository) ||
        collapsedPaths.has(normalizePath(repository.path))
      ) {
        return [item]
      }

      return [
        item,
        ...createItems(repository.path, getGroupKey(group.identifier), 0),
      ]
    }),
  }))
}

/**
 * The normalized paths of all submodules we know about, at any level of
 * nesting, so that they can be excluded from the list of top-level
 * repositories.
 */
export function getSubmodulePaths(
  submodules: ReadonlyMap<string, ReadonlyArray<SubmoduleEntry>>
): ReadonlySet<string> {
  const paths = new Set<string>()

  for (const [parentPath, entries] of submodules) {
    for (const entry of entries) {
      paths.add(normalizePath(Path.resolve(parentPath, entry.path)))
    }
  }

  return paths
}

/**
 * Returns the normalized paths of all repositories and submodules which have to
 * be expanded in order for the given path to be visible in the list.
 */
export function getParentPaths(
  submodules: ReadonlyMap<string, ReadonlyArray<SubmoduleEntry>>,
  path: string
): ReadonlyArray<string> {
  const parents = new Array<string>()
  let needle = normalizePath(path)

  // Submodules can't contain themselves so the chain is guaranteed to be
  // finite, but the map is built from what's on disk so let's not take any
  // chances.
  const seen = new Set<string>([needle])

  while (true) {
    const parent = [...submodules].find(([parentPath, entries]) =>
      entries.some(
        entry => normalizePath(Path.resolve(parentPath, entry.path)) === needle
      )
    )

    if (parent === undefined || seen.has(normalizePath(parent[0]))) {
      return parents
    }

    needle = normalizePath(parent[0])
    seen.add(needle)
    parents.push(needle)
  }
}

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
        branchName: repoState?.branchName ?? null,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}

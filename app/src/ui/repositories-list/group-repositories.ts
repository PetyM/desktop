import {
  Repository,
  ILocalRepositoryState,
  nameOf,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { caseInsensitiveCompare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { SubmoduleEntry } from '../../models/submodule'
import { matchExistingRepository } from '../../lib/repository-matching'
import { normalizePath } from '../../lib/path'
import * as Path from 'path'
import * as Os from 'os'

export type RepositoryListGroup = {
  /** The absolute path of the folder the group's repositories live in */
  readonly path: string
}

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case insensitive sorting key (i.e the case insensitive sort order of the keys
 * is the order in which the groups will be displayed in the repository list).
 *
 * Normalized so that folders which only differ in casing end up in the same
 * group on Windows, while the group keeps the casing of the first repository
 * we saw in that folder.
 */
export const getGroupKey = (group: RepositoryListGroup) =>
  normalizePath(group.path)
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
        // Prefixed with the group key to keep the id unique should the same
        // submodule ever show up in more than one group.
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

/** The folder a repository is grouped by, i.e. the one containing it */
const getGroupForRepository = (repo: Repositoryish): RepositoryListGroup => ({
  path: Path.dirname(Path.resolve(repo.path)),
})

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
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
    addToGroup(getGroupForRepository(repo), repo)
  }

  return Array.from(groups)
    .sort(([xKey], [yKey]) => caseInsensitiveCompare(xKey, yKey))
    .map(([, { group, repos }]) => ({
      identifier: group,
      items: toSortedListItems(repos, localRepositoryStateLookup),
    }))
}

// Returns the display title for a repository, which is either the alias
// (if available) or the name.
const getDisplayTitle = (r: Repositoryish) =>
  r instanceof Repository && r.alias != null ? r.alias : r.name

const toSortedListItems = (
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): IRepositoryListItem[] => {
  const names = new Map<string, number>()

  for (const title of repositories.map(getDisplayTitle)) {
    names.set(title, (names.get(title) ?? 0) + 1)
  }

  return repositories
    .map(r => {
      const repoState = localRepositoryStateLookup.get(r.id)
      const title = getDisplayTitle(r)

      return {
        text: r instanceof Repository ? [title, nameOf(r)] : [title],
        id: r.id.toString(),
        repository: r,
        needsDisambiguation: (names.get(title) ?? 0) > 1,
        aheadBehind: repoState?.aheadBehind ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
        branchName: repoState?.branchName ?? null,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}

const pathSegments = (path: string) => Path.resolve(path).split(Path.sep)

const equalSegments = (x: string, y: string) =>
  __WIN32__ ? x.toLowerCase() === y.toLowerCase() : x === y

/**
 * The deepest folder all the given paths live in, or null if they've got
 * nothing but the root of the file system (or the drive) in common.
 */
function getCommonAncestorPath(paths: ReadonlyArray<string>) {
  const [first, ...rest] = paths.map(pathSegments)
  let common = first

  for (const segments of rest) {
    let length = 0

    while (
      length < common.length &&
      length < segments.length &&
      equalSegments(common[length], segments[length])
    ) {
      length++
    }

    common = common.slice(0, length)
  }

  // The first segment is the root ('' on macOS and Linux, the drive on
  // Windows), which on its own doesn't say anything about where the
  // repositories are.
  return common.length > 1 ? common.join(Path.sep) : null
}

const homeDirectory = Os.homedir()

const shortenHomeDirectory = (path: string) =>
  path === homeDirectory || path.startsWith(homeDirectory + Path.sep)
    ? `~${path.slice(homeDirectory.length)}`
    : path

/**
 * Produces the label to show for each of the given folders, dropping the part
 * of the path all of them have in common so that the headers stay short and
 * tell the folders apart.
 */
export function getFolderGroupLabels(
  folders: ReadonlyArray<string>
): ReadonlyMap<string, string> {
  const ancestor = folders.length > 1 ? getCommonAncestorPath(folders) : null
  const labels = new Map<string, string>()

  for (const folder of folders) {
    if (ancestor === null) {
      labels.set(folder, shortenHomeDirectory(folder))
    } else {
      // The common ancestor is one of the folders itself when the repositories
      // of one group live inside the folder of another one.
      const relative = Path.relative(ancestor, folder)
      labels.set(folder, relative.length > 0 ? relative : Path.basename(folder))
    }
  }

  return labels
}

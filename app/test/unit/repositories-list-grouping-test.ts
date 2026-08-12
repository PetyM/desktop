import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  getFolderGroupLabels,
  getParentPaths,
  getSubmodulePaths,
  groupRepositories,
  insertSubmoduleItems,
} from '../../src/ui/repositories-list/group-repositories'
import { normalizePath } from '../../src/lib/path'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import { SubmoduleEntry, SubmoduleStatus } from '../../src/models/submodule'

describe('repository list grouping', () => {
  const root = Path.resolve(Path.sep, 'src')
  const work = Path.join(root, 'work')
  const play = Path.join(root, 'play')

  const cache = new Map<number, ILocalRepositoryState>()

  it('groups repositories by the folder they live in', () => {
    const repositories: Array<Repository | CloningRepository> = [
      new Repository(Path.join(work, 'repo1'), 1, null, false),
      new Repository(
        Path.join(play, 'repo2'),
        2,
        gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
        false
      ),
      new CloningRepository(
        Path.join(work, 'repo3'),
        'https://github.com/me/repo3'
      ),
    ]

    const grouped = groupRepositories(repositories, cache, [])
    assert.equal(grouped.length, 2)

    assert.deepStrictEqual(grouped[0].identifier, {
      kind: 'folder',
      path: play,
    })
    assert.equal(grouped[0].items.length, 1)
    assert.equal(grouped[0].items[0].repository?.path, Path.join(play, 'repo2'))

    assert.deepStrictEqual(grouped[1].identifier, {
      kind: 'folder',
      path: work,
    })
    assert.equal(grouped[1].items.length, 2)
    assert.equal(grouped[1].items[0].repository?.path, Path.join(work, 'repo1'))
    assert.equal(grouped[1].items[1].repository?.path, Path.join(work, 'repo3'))
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository(Path.join(work, 'a'), 1, null, false)
    const repoB = new Repository(
      Path.join(play, 'b'),
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository(Path.join(work, 'c'), 3, null, false)
    const repoD = new Repository(
      Path.join(play, 'd'),
      4,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository(Path.join(work, 'z'), 5, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      []
    )
    assert.equal(grouped.length, 2)

    assert.deepStrictEqual(grouped[0].identifier, {
      kind: 'folder',
      path: play,
    })
    let items = grouped[0].items
    assert.deepStrictEqual(
      items.map(i => i.repository?.path),
      [repoB.path, repoD.path]
    )

    assert.deepStrictEqual(grouped[1].identifier, {
      kind: 'folder',
      path: work,
    })
    items = grouped[1].items
    assert.deepStrictEqual(
      items.map(i => i.repository?.path),
      [repoA.path, repoC.path, repoZ.path]
    )
  })

  it('labels the groups by what sets their folders apart', () => {
    const labels = getFolderGroupLabels([work, play, Path.join(play, 'toys')])

    assert.equal(labels.get(work), 'work')
    assert.equal(labels.get(play), 'play')
    assert.equal(labels.get(Path.join(play, 'toys')), Path.join('play', 'toys'))
  })

  it('labels a lone group by the folder it lives in', () => {
    const labels = getFolderGroupLabels([work])

    assert.equal(labels.get(work), work)
  })

  it('labels the folders relative to the deepest one they share', () => {
    const labels = getFolderGroupLabels([work, Path.join(work, 'clients')])

    assert.equal(labels.get(work), 'work')
    assert.equal(labels.get(Path.join(work, 'clients')), 'clients')
  })
})

describe('repository list submodules', () => {
  const parentPath = Path.resolve('a', 'parent')
  const submodulePath = Path.resolve('a', 'parent', 'vendor', 'lib')
  const nestedPath = Path.resolve(
    'a',
    'parent',
    'vendor',
    'lib',
    'deps',
    'tiny'
  )

  const parent = new Repository(parentPath, 1, null, false)

  const entry = new SubmoduleEntry(
    'c59617b65080863c4ca72c1f191fa1b423b92223',
    'vendor/lib',
    'v1.2.0',
    SubmoduleStatus.Modified
  )

  const nestedEntry = new SubmoduleEntry(
    '14425bb2a4ee361af7f789a81b971f8466ae521d',
    'deps/tiny',
    'v0.1.0'
  )

  const submodules = new Map([
    [normalizePath(parentPath), [entry]],
    [normalizePath(submodulePath), [nestedEntry]],
  ])

  const cache = new Map<number, ILocalRepositoryState>()

  const collapse = (
    paths: ReadonlyArray<string>,
    repositories: ReadonlyArray<Repository> = [parent]
  ) =>
    insertSubmoduleItems(
      groupRepositories([parent], cache, []),
      submodules,
      new Set(paths.map(normalizePath)),
      repositories,
      cache
    )[0].items

  it('lists the submodules of every level by default', () => {
    const items = collapse([])

    assert.equal(items.length, 3)

    assert.equal(items[1].submodule?.entry, entry)
    assert.equal(items[1].submodule?.depth, 0)
    assert.equal(items[1].text[0], 'vendor/lib')

    assert.equal(items[2].submodule?.entry, nestedEntry)
    assert.equal(items[2].submodule?.path, nestedPath)
    assert.equal(items[2].submodule?.depth, 1)
  })

  it('hides the submodules of a collapsed repository', () => {
    assert.equal(collapse([parentPath]).length, 1)
  })

  it('hides the submodules of a collapsed submodule', () => {
    const items = collapse([submodulePath])

    assert.equal(items.length, 2)
    assert.equal(items[1].submodule?.entry, entry)
  })

  it('knows whether a submodule has submodules of its own', () => {
    assert.equal(collapse([])[1].submodule?.submoduleCount, 1)
  })

  it('references the repository of a submodule which has been opened', () => {
    const submodule = new Repository(submodulePath, 2, null, false)
    const items = collapse([], [parent, submodule])

    assert.equal(items[1].repository, submodule)
  })

  it('has no repository for a submodule which hasn’t been opened', () => {
    assert.equal(collapse([])[1].repository, null)
  })

  it('lists the paths of every known submodule', () => {
    assert.deepStrictEqual(
      [...getSubmodulePaths(submodules)],
      [normalizePath(submodulePath), normalizePath(nestedPath)]
    )
  })

  it('returns the paths to expand in order to reveal a submodule', () => {
    assert.deepStrictEqual(getParentPaths(submodules, nestedPath), [
      normalizePath(submodulePath),
      normalizePath(parentPath),
    ])

    assert.deepStrictEqual(getParentPaths(submodules, parentPath), [])
  })
})

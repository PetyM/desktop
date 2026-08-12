import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  getParentPaths,
  getSubmodulePaths,
  groupRepositories,
  insertSubmoduleItems,
} from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import { SubmoduleEntry, SubmoduleStatus } from '../../src/models/submodule'
import { normalizePath } from '../../src/lib/path'

describe('repository list grouping', () => {
  const repositories: Array<Repository | CloningRepository> = [
    new Repository('repo1', 1, null, false),
    new Repository(
      'repo2',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
      false
    ),
    new Repository(
      'repo3',
      3,
      gitHubRepoFixture({
        owner: '',
        name: 'my-repo3',
        endpoint: 'https://github.big-corp.com/api/v3',
      }),
      false
    ),
  ]

  const cache = new Map<number, ILocalRepositoryState>()

  it('groups repositories by owners/Enterprise/Other', () => {
    const grouped = groupRepositories(repositories, cache, [])
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 1)

    let item = grouped[0].items[0]
    assert.equal(item.repository?.path, 'repo2')

    assert.equal(grouped[1].identifier.kind, 'enterprise')
    assert.equal(grouped[1].items.length, 1)

    item = grouped[1].items[0]
    assert.equal(item.repository?.path, 'repo3')

    assert.equal(grouped[2].identifier.kind, 'other')
    assert.equal(grouped[2].items.length, 1)

    item = grouped[2].items[0]
    assert.equal(item.repository?.path, 'repo1')
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository('a', 1, null, false)
    const repoB = new Repository(
      'b',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository('c', 2, null, false)
    const repoD = new Repository(
      'd',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository('z', 3, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      []
    )
    assert.equal(grouped.length, 2)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 2)

    let items = grouped[0].items
    assert.equal(items[0].repository?.path, 'b')
    assert.equal(items[1].repository?.path, 'd')

    assert.equal(grouped[1].identifier.kind, 'other')
    assert.equal(grouped[1].items.length, 3)

    items = grouped[1].items
    assert.equal(items[0].repository?.path, 'a')
    assert.equal(items[1].repository?.path, 'c')
    assert.equal(items[2].repository?.path, 'z')
  })

  it('only disambiguates Enterprise repositories', () => {
    const repoA = new Repository(
      'repo',
      1,
      gitHubRepoFixture({ owner: 'user1', name: 'repo' }),
      false
    )
    const repoB = new Repository(
      'repo',
      2,
      gitHubRepoFixture({ owner: 'user2', name: 'repo' }),
      false
    )
    const repoC = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'business',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )
    const repoD = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'silliness',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )

    const grouped = groupRepositories([repoA, repoB, repoC, repoD], cache, [])
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'user1')
    assert.equal(grouped[0].items.length, 1)

    assert.equal(grouped[1].identifier.kind, 'dotcom')
    assert.equal((grouped[1].identifier as any).owner.login, 'user2')
    assert.equal(grouped[1].items.length, 1)

    assert.equal(grouped[2].identifier.kind, 'enterprise')
    assert.equal(grouped[2].items.length, 2)

    assert.equal(grouped[0].items[0].text[0], 'repo')
    assert(!grouped[0].items[0].needsDisambiguation)

    assert.equal(grouped[1].items[0].text[0], 'repo')
    assert(!grouped[1].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[0].text[0], 'enterprise-repo')
    assert(grouped[2].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[1].text[0], 'enterprise-repo')
    assert(grouped[2].items[1].needsDisambiguation)
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

  const expand = (
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

  it('lists the submodules of expanded repositories only', () => {
    assert.equal(expand([]).length, 1)

    const items = expand([parentPath])

    assert.equal(items.length, 2)
    assert.equal(items[1].submodule?.entry, entry)
    assert.equal(items[1].submodule?.depth, 0)
    assert.equal(items[1].text[0], 'vendor/lib')
  })

  it('lists the submodules of expanded submodules', () => {
    const items = expand([parentPath, submodulePath])

    assert.equal(items.length, 3)
    assert.equal(items[2].submodule?.entry, nestedEntry)
    assert.equal(items[2].submodule?.path, nestedPath)
    assert.equal(items[2].submodule?.depth, 1)
  })

  it('knows whether a submodule has submodules of its own', () => {
    const items = expand([parentPath])

    assert.equal(items[1].submodule?.submoduleCount, 1)
  })

  it('references the repository of a submodule which has been opened', () => {
    const submodule = new Repository(submodulePath, 2, null, false)
    const items = expand([parentPath], [parent, submodule])

    assert.equal(items[1].repository, submodule)
  })

  it('has no repository for a submodule which hasn’t been opened', () => {
    assert.equal(expand([parentPath])[1].repository, null)
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

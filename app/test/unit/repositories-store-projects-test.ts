import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { RepositoriesStore } from '../../src/lib/stores/repositories-store'
import { TestRepositoriesDatabase } from '../helpers/databases'

describe('RepositoriesStore projects', () => {
  let repoDb = new TestRepositoriesDatabase()
  let repositoriesStore = new RepositoriesStore(repoDb)

  beforeEach(async () => {
    repoDb = new TestRepositoriesDatabase()
    await repoDb.reset()
    repositoriesStore = new RepositoriesStore(repoDb)
  })

  afterEach(() => {
    repoDb.close()
  })

  it('creates a project containing the given repositories', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const project = await repositoriesStore.createProject('Work', [repository])

    assert.deepStrictEqual(await repositoriesStore.getAllProjects(), [project])

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.deepStrictEqual(memberships.get(repository.id), [project.id])
  })

  it('trims the project name', async () => {
    const project = await repositoriesStore.createProject('  Work  ')
    assert.equal(project.name, 'Work')
  })

  it('refuses to create two projects with the same name', async () => {
    await repositoriesStore.createProject('Work')

    await assert.rejects(
      repositoriesStore.createProject('work'),
      /already exists/
    )

    assert.equal((await repositoriesStore.getAllProjects()).length, 1)
  })

  it('lets a repository belong to more than one project', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const work = await repositoriesStore.createProject('Work')
    const hobby = await repositoriesStore.createProject('Hobby')

    await repositoriesStore.setRepositoryProjects(repository, [
      work.id,
      hobby.id,
    ])

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.deepStrictEqual(memberships.get(repository.id), [work.id, hobby.id])
  })

  it('replaces the projects of a repository', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const work = await repositoriesStore.createProject('Work', [repository])
    const hobby = await repositoriesStore.createProject('Hobby', [repository])

    await repositoriesStore.setRepositoryProjects(repository, [hobby.id])

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.deepStrictEqual(memberships.get(repository.id), [hobby.id])
    assert.equal((await repositoriesStore.getAllProjects()).length, 2)
    assert.equal(work.name, 'Work')
  })

  it('adds repositories to a project without touching their other projects', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const other = await repositoriesStore.addRepository(
      '/some/other/path',
      '/some/other/path/.git'
    )
    const work = await repositoriesStore.createProject('Work', [repository])
    const hobby = await repositoriesStore.createProject('Hobby')

    await repositoriesStore.addRepositoriesToProject(hobby.id, [
      repository,
      other,
    ])

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.deepStrictEqual(memberships.get(repository.id), [work.id, hobby.id])
    assert.deepStrictEqual(memberships.get(other.id), [hobby.id])
  })

  it('ignores repositories already in the project', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const work = await repositoriesStore.createProject('Work', [repository])

    await repositoriesStore.addRepositoriesToProject(work.id, [repository])

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.deepStrictEqual(memberships.get(repository.id), [work.id])
  })

  it('renames a project', async () => {
    const project = await repositoriesStore.createProject('Work')

    await repositoriesStore.renameProject(project, 'Day job')

    assert.deepStrictEqual(await repositoriesStore.getAllProjects(), [
      { id: project.id, name: 'Day job' },
    ])
  })

  it('allows a project to keep its own name when renaming', async () => {
    const project = await repositoriesStore.createProject('Work')

    await assert.doesNotReject(repositoriesStore.renameProject(project, 'Work'))
  })

  it('keeps the repositories when a project is deleted', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const project = await repositoriesStore.createProject('Work', [repository])

    await repositoriesStore.deleteProject(project)

    assert.equal((await repositoriesStore.getAllProjects()).length, 0)
    assert.deepStrictEqual(
      await repositoriesStore.getRepositoryProjects(),
      new Map()
    )
    assert.equal((await repositoriesStore.getAll()).length, 1)
  })

  it('forgets the memberships of a removed repository', async () => {
    const repository = await repositoriesStore.addRepository(
      '/some/cool/path',
      '/some/cool/path/.git'
    )
    const other = await repositoriesStore.addRepository(
      '/some/other/path',
      '/some/other/path/.git'
    )
    const project = await repositoriesStore.createProject('Work', [
      repository,
      other,
    ])

    await repositoriesStore.removeRepository(repository)

    const memberships = await repositoriesStore.getRepositoryProjects()
    assert.equal(memberships.get(repository.id), undefined)
    assert.deepStrictEqual(memberships.get(other.id), [project.id])
  })
})

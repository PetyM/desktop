import * as React from 'react'

import { commitGrammar, RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
  getParentPaths,
  getSubmodulePaths,
  insertSubmoduleItems,
} from './group-repositories'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { IMenuItem } from '../../lib/menu-item'
import { PopupType } from '../../models/popup'
import { encodePathAsUrl, normalizePath } from '../../lib/path'
import { TooltippedContent } from '../lib/tooltipped-content'
import memoizeOne from 'memoize-one'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { enableWorktreeSupport } from '../../lib/feature-flag'
import { SectionFilterList } from '../lib/section-filter-list'
import { assertNever } from '../../lib/fatal-error'
import { IAheadBehind } from '../../models/branch'
import { IProject } from '../../models/project'
import { ProjectSwitcher } from './project-switcher'
import { CloningRepository } from '../../models/cloning-repository'
import { SubmoduleEntry } from '../../models/submodule'

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')

interface IRepositoriesListProps {
  readonly selectedRepository: Repositoryish | null
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly recentRepositories: ReadonlyArray<number>

  /** A cache of the latest repository state values, keyed by the repository id */
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Called when a repository has been selected. */
  readonly onSelectionChanged: (repository: Repositoryish) => void

  /** Whether the user has enabled the setting to confirm removing a repository from the app */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the default web browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be shown in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string

  /** The callback to fire when the filter text has changed */
  readonly onFilterTextChanged: (text: string) => void

  /** The text entered by the user to filter their repository list */
  readonly filterText: string

  /** The projects the user has created */
  readonly projects: ReadonlyArray<IProject>

  /** The projects each repository belongs to, keyed by repository id */
  readonly repositoryProjects: ReadonlyMap<number, ReadonlyArray<number>>

  /** The project the list is filtered by, or null when showing everything */
  readonly selectedProjectId: number | null

  /**
   * The submodules of each repository and submodule we've looked at so far,
   * keyed by the normalized path they belong to
   */
  readonly repositorySubmodules: ReadonlyMap<
    string,
    ReadonlyArray<SubmoduleEntry>
  >

  readonly dispatcher: Dispatcher
}

interface IRepositoriesListState {
  readonly newRepositoryMenuExpanded: boolean
  readonly selectedItem: IRepositoryListItem | null

  /**
   * The normalized paths of the repositories and submodules whose submodules
   * the user has hidden. Everything else is expanded.
   */
  readonly collapsedPaths: ReadonlySet<string>
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  selectedRepository: Repositoryish | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.repository?.id === selectedRepository.id) {
          return item
        }
      }
    }
  }

  return null
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
      recentRepositories: ReadonlyArray<number>
    ) =>
      repositories === null
        ? []
        : groupRepositories(
            repositories,
            localRepositoryStateLookup,
            recentRepositories
          )
  )

  /**
   * A memoized function for finding the selected list item based
   * on an IAPIRepository instance. The selected item will not be
   * recomputed as long as the provided list of repositories and
   * the selected data object is equal to the last time the method
   * was called (reference equality).
   *
   * See findMatchingListItem for more details.
   */
  private getSelectedListItem = memoizeOne(findMatchingListItem)

  /**
   * A memoized function for adding the submodules of the repositories to the
   * groups produced by `getRepositoryGroups`.
   */
  private getGroupsWithSubmodules = memoizeOne(insertSubmoduleItems)

  /**
   * A memoized function expanding everything owning the selected repository,
   * regardless of whether the user has collapsed it, so that the selected
   * repository is always visible in the list.
   */
  private getCollapsedPaths = memoizeOne(
    (
      collapsedPaths: ReadonlySet<string>,
      selectedRepository: Repositoryish | null,
      submodules: ReadonlyMap<string, ReadonlyArray<SubmoduleEntry>>
    ) => {
      if (!(selectedRepository instanceof Repository)) {
        return collapsedPaths
      }

      const parents = getParentPaths(submodules, selectedRepository.path)

      return parents.some(p => collapsedPaths.has(p))
        ? new Set([...collapsedPaths].filter(p => !parents.includes(p)))
        : collapsedPaths
    }
  )

  /**
   * A memoized function narrowing the repositories down to the ones belonging
   * to the selected project. Repositories currently being cloned are always
   * included since they can't be assigned to a project until they're done.
   */
  private getVisibleRepositories = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish>,
      repositoryProjects: ReadonlyMap<number, ReadonlyArray<number>>,
      selectedProjectId: number | null,
      repositorySubmodules: ReadonlyMap<string, ReadonlyArray<SubmoduleEntry>>
    ) => {
      const inSelectedProject = (r: Repositoryish) =>
        selectedProjectId === null ||
        r instanceof CloningRepository ||
        repositoryProjects.get(r.id)?.includes(selectedProjectId) === true

      // Submodules are listed underneath the repository or submodule they
      // belong to so we don't want them showing up as top-level repositories as
      // well, even though that's how they're stored once they've been opened.
      const submodulePaths = getSubmodulePaths(repositorySubmodules)

      return repositories.filter(
        r => inSelectedProject(r) && !submodulePaths.has(normalizePath(r.path))
      )
    }
  )

  public constructor(props: IRepositoriesListProps) {
    super(props)

    this.state = {
      newRepositoryMenuExpanded: false,
      selectedItem: null,
      collapsedPaths: new Set<string>(),
    }
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const { repository, submodule } = item
    const path = submodule?.path ?? repository?.path ?? null

    const submoduleCount =
      submodule?.submoduleCount ??
      (repository instanceof Repository
        ? (
            this.props.repositorySubmodules.get(
              normalizePath(repository.path)
            ) ?? []
          ).length
        : 0)

    return (
      <RepositoryListItem
        key={item.id}
        repository={repository}
        needsDisambiguation={item.needsDisambiguation}
        matches={matches}
        aheadBehind={item.aheadBehind}
        changedFilesCount={item.changedFilesCount}
        branchName={item.branchName}
        submodule={submodule}
        submoduleCount={submoduleCount}
        isExpanded={
          path !== null &&
          !this.getCollapsedPaths(
            this.state.collapsedPaths,
            this.props.selectedRepository,
            this.props.repositorySubmodules
          ).has(normalizePath(path))
        }
        onToggleExpanded={this.onToggleExpanded}
      />
    )
  }

  private onToggleExpanded = (path: string) => {
    const collapsedPaths = new Set(this.state.collapsedPaths)
    const normalized = normalizePath(path)

    if (!collapsedPaths.delete(normalized)) {
      collapsedPaths.add(normalized)
    } else {
      // Picks up any submodules added since we last looked at this one
      this.props.dispatcher.refreshSubmodules(path)
    }

    this.setState({ collapsedPaths })
  }

  private getAheadBehindTooltip = (aheadBehind: IAheadBehind | null) => {
    if (aheadBehind === null) {
      return null
    }

    const { ahead, behind } = aheadBehind

    if (behind === 0 && ahead === 0) {
      return null
    }

    return (
      'The currently checked out branch is' +
      (behind ? ` ${commitGrammar(behind)} behind ` : '') +
      (behind && ahead ? 'and' : '') +
      (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
      'its tracked branch.'
    )
  }

  private renderRowFocusTooltip = (
    item: IRepositoryListItem
  ): JSX.Element | string | null => {
    const { repository, aheadBehind, changedFilesCount } = item
    if (repository === null) {
      return null
    }

    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repository.name
    const aheadBehindTooltip = this.getAheadBehindTooltip(aheadBehind)
    const hasChanges = changedFilesCount > 0
    const uncommittedChangesTooltip = hasChanges
      ? `There are uncommitted changes in this repository.`
      : null

    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0

    return (
      <div className="repository-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {realName}
          {alias && <> ({alias})</>}
        </div>
        <div>
          <div className="label">Path: </div>
          {repository.path}
        </div>
        {aheadBehindTooltip && (
          <div>
            <div className="label">
              <div className="ahead-behind">
                {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
                {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
              </div>
            </div>
            {aheadBehindTooltip}
          </div>
        )}
        {uncommittedChangesTooltip && (
          <div>
            <div className="label">
              <span className="change-indicator-wrapper">
                <Octicon symbol={octicons.dotFill} />
              </span>
            </div>
            {uncommittedChangesTooltip}
          </div>
        )}
      </div>
    )
  }

  private getGroupLabel(group: RepositoryListGroup) {
    const { kind } = group
    if (kind === 'enterprise') {
      return group.host
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return group.owner.login
    } else if (kind === 'recent') {
      return 'Recent'
    } else {
      assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private renderGroupHeader = (group: RepositoryListGroup) => {
    const label = this.getGroupLabel(group)

    return (
      <TooltippedContent
        key={getGroupKey(group)}
        className="filter-list-group-header"
        tooltip={label}
        onlyWhenOverflowed={true}
        tagName="div"
      >
        {label}
      </TooltippedContent>
    )
  }

  private onItemClick = (item: IRepositoryListItem) => {
    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)

    if (item.repository !== null) {
      this.props.onSelectionChanged(item.repository)
    } else if (item.submodule !== undefined) {
      // The submodule isn't known to the app yet, opening it adds it to the
      // list of repositories and selects it.
      this.props.dispatcher.openSubmodule(item.submodule.path)
    }
  }

  private onItemContextMenu = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

    if (item.repository === null) {
      return
    }

    const items = generateRepositoryListContextMenu({
      onRemoveRepository: this.props.onRemoveRepository,
      onShowRepository: this.props.onShowRepository,
      onOpenInShell: this.props.onOpenInShell,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      externalEditorLabel: this.props.externalEditorLabel,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onViewOnGitHub: this.props.onViewOnGitHub,
      onCreateWorktree: enableWorktreeSupport()
        ? this.onCreateWorktree
        : undefined,
      onShowWorktrees: enableWorktreeSupport()
        ? this.onShowWorktrees
        : undefined,
      repository: item.repository,
      shellLabel: this.props.shellLabel,
      projects: this.props.projects,
      repositoryProjectIds:
        this.props.repositoryProjects.get(item.repository.id) ?? [],
      onToggleProject: this.onToggleRepositoryProject,
      onAddToNewProject: this.onAddRepositoryToNewProject,
    })

    showContextualMenu(items)
  }

  private getItemAriaLabel = (item: IRepositoryListItem) =>
    item.submodule?.entry.path ?? item.repository?.name
  private getGroupAriaLabelGetter =
    (
      groups: ReadonlyArray<
        IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
      >
    ) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  public render() {
    const repositories = this.getVisibleRepositories(
      this.props.repositories,
      this.props.repositoryProjects,
      this.props.selectedProjectId,
      this.props.repositorySubmodules
    )

    const collapsedPaths = this.getCollapsedPaths(
      this.state.collapsedPaths,
      this.props.selectedRepository,
      this.props.repositorySubmodules
    )

    const groups = this.getGroupsWithSubmodules(
      this.getRepositoryGroups(
        repositories,
        this.props.localRepositoryStateLookup,
        this.props.recentRepositories
      ),
      this.props.repositorySubmodules,
      collapsedPaths,
      this.props.repositories,
      this.props.localRepositoryStateLookup
    )

    // So there's two types of selection at play here. There's the repository
    // selection for the whole app and then there's the keyboard selection in
    // the list itself. If the user has selected a repository using keyboard
    // navigation we want to honor that selection. If the user hasn't selected a
    // repository yet we'll select the repository currently selected in the app.
    const selectedItem =
      this.state.selectedItem ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    return (
      <div className="repository-list">
        <div className="repository-list-contents">
          <ProjectSwitcher
            projects={this.props.projects}
            selectedProject={this.getSelectedProject()}
            onSelectedProjectChanged={this.onSelectedProjectChanged}
            onCreateProject={this.onCreateProject}
            onRenameProject={this.onRenameProject}
            onDeleteProject={this.onDeleteProject}
          />
          <SectionFilterList<IRepositoryListItem, RepositoryListGroup>
            rowHeight={RowHeight}
            selectedItem={selectedItem}
            filterText={this.props.filterText}
            onFilterTextChanged={this.props.onFilterTextChanged}
            renderItem={this.renderItem}
            renderRowFocusTooltip={this.renderRowFocusTooltip}
            renderGroupHeader={this.renderGroupHeader}
            onItemClick={this.onItemClick}
            renderPostFilter={this.renderPostFilter}
            renderNoItems={this.renderNoItems}
            groups={groups}
            invalidationProps={{
              repositories,
              filterText: this.props.filterText,
              submodules: this.props.repositorySubmodules,
              collapsedPaths: this.state.collapsedPaths,
            }}
            onItemContextMenu={this.onItemContextMenu}
            getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
            getItemAriaLabel={this.getItemAriaLabel}
            onSelectionChanged={this.onSelectionChanged}
          />
        </div>
      </div>
    )
  }

  private onSelectionChanged = (selectedItem: IRepositoryListItem | null) => {
    this.setState({ selectedItem })
  }

  private getSelectedProject() {
    const { projects, selectedProjectId } = this.props

    return projects.find(p => p.id === selectedProjectId) ?? null
  }

  private onSelectedProjectChanged = (projectId: number | null) => {
    this.props.dispatcher.setSelectedProject(projectId)
  }

  private onCreateProject = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateProject })
  }

  private onRenameProject = (project: IProject) => {
    this.props.dispatcher.showPopup({ type: PopupType.RenameProject, project })
  }

  private onDeleteProject = (project: IProject) => {
    this.props.dispatcher.showPopup({ type: PopupType.DeleteProject, project })
  }

  private onToggleRepositoryProject = (
    repository: Repository,
    projectId: number,
    isMember: boolean
  ) => {
    const current = this.props.repositoryProjects.get(repository.id) ?? []
    const projectIds = isMember
      ? current.filter(id => id !== projectId)
      : [...current, projectId]

    this.props.dispatcher.setRepositoryProjects(repository, projectIds)
  }

  private onAddRepositoryToNewProject = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.CreateProject,
      repository,
    })
  }

  private renderPostFilter = () => {
    return (
      <Button
        className="new-repository-button"
        onClick={this.onNewRepositoryButtonClick}
        ariaExpanded={this.state.newRepositoryMenuExpanded}
        onKeyDown={this.onNewRepositoryButtonKeyDown}
      >
        Add
        <Octicon symbol={octicons.triangleDown} />
      </Button>
    )
  }

  private onNewRepositoryButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      this.onNewRepositoryButtonClick()
    }
  }

  private renderNoItems = () => {
    const selectedProject = this.getSelectedProject()

    if (selectedProject !== null && this.props.filterText.length === 0) {
      return (
        <div className="no-items no-results-found">
          <img src={BlankSlateImage} className="blankslate-image" alt="" />
          <div className="title">
            There are no repositories in "{selectedProject.name}"
          </div>
          <div className="protip">
            Right click a repository and use the Projects menu to add it to this
            project.
          </div>
        </div>
      )
    }

    return (
      <div className="no-items no-results-found">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />
        <div className="title">Sorry, I can't find that repository</div>

        <div className="protip">
          ProTip! Press{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut darwinKeys={['⌘', 'O']} keys={['Ctrl', 'O']} />
          </div>{' '}
          to quickly add a local repository, and{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut
              darwinKeys={['⇧', '⌘', 'O']}
              keys={['Ctrl', 'Shift', 'O']}
            />
          </div>{' '}
          to clone from anywhere within the app
        </div>
      </div>
    )
  }

  private onNewRepositoryButtonClick = () => {
    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: this.onCloneRepository,
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: this.onCreateNewRepository,
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: this.onAddExistingRepository,
      },
    ]

    this.setState({ newRepositoryMenuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ newRepositoryMenuExpanded: false })
    })
  }

  private onCloneRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onAddExistingRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private onCreateNewRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateRepository })
  }

  private onChangeRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })
  }

  private onRemoveRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.changeRepositoryAlias(repository, null)
  }

  private onCreateWorktree = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository,
    })
  }

  private onShowWorktrees = (repository: Repository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.showWorktreesFoldout()
  }
}

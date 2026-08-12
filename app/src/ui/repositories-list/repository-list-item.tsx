import * as React from 'react'

import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ISubmoduleListItemData, Repositoryish } from './group-repositories'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { IAheadBehind } from '../../models/branch'
import classNames from 'classnames'
import { createObservableRef } from '../lib/observable-ref'
import { Tooltip } from '../lib/tooltip'
import { enableAccessibleListToolTips } from '../../lib/feature-flag'
import { TooltippedContent } from '../lib/tooltipped-content'
import { SubmoduleStatus } from '../../models/submodule'

interface IRepositoryListItemProps {
  /**
   * The repository this item represents, or null when the item is a submodule
   * which hasn't been opened yet.
   */
  readonly repository: Repositoryish | null

  /** Does the repository need to be disambiguated in the list? */
  readonly needsDisambiguation: boolean

  /** The characters in the repository name to highlight */
  readonly matches: IMatches

  /** Number of commits this local repo branch is behind or ahead of its remote branch */
  readonly aheadBehind: IAheadBehind | null

  /** Number of uncommitted changes */
  readonly changedFilesCount: number

  /** Set when this item is a submodule of the repository listed above it */
  readonly submodule?: ISubmoduleListItemData

  /** The number of submodules of this repository */
  readonly submoduleCount: number

  /** Whether or not the submodules of this repository are shown */
  readonly isExpanded: boolean

  /** Called when the user wants to show or hide the submodules */
  readonly onToggleExpanded?: (repository: Repository) => void
}

/** A repository item. */
export class RepositoryListItem extends React.Component<
  IRepositoryListItemProps,
  {}
> {
  private readonly listItemRef = createObservableRef<HTMLDivElement>()

  public render() {
    const { repository, submodule } = this.props

    if (submodule !== undefined) {
      return this.renderSubmodule(submodule)
    }

    if (repository === null) {
      return null
    }

    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const hasChanges = this.props.changedFilesCount > 0

    const alias: string | null =
      repository instanceof Repository ? repository.alias : null

    let prefix: string | null = null
    if (this.props.needsDisambiguation && gitHubRepo) {
      prefix = `${gitHubRepo.owner.login}/`
    }

    const classNameList = classNames('name', {
      alias: alias !== null,
    })

    return (
      <div className="repository-list-item" ref={this.listItemRef}>
        <Tooltip
          target={this.listItemRef}
          disabled={enableAccessibleListToolTips()}
        >
          {this.renderTooltip()}
        </Tooltip>

        {this.renderExpandCollapse()}

        <Octicon
          className="icon-for-repository"
          symbol={iconForRepository(repository)}
        />

        <div className={classNames(classNameList)}>
          {prefix ? <span className="prefix">{prefix}</span> : null}
          <HighlightText
            text={alias ?? repository.name}
            highlight={this.props.matches.title}
          />
        </div>

        {repository instanceof Repository &&
          renderRepoIndicators({
            aheadBehind: this.props.aheadBehind,
            hasChanges: hasChanges,
          })}
      </div>
    )
  }

  private renderExpandCollapse() {
    const { repository, submoduleCount, isExpanded } = this.props

    if (!(repository instanceof Repository) || submoduleCount === 0) {
      // Rendered even when there's nothing to expand so that repositories with
      // and without submodules line up with each other.
      return <div className="expand-collapse-placeholder" />
    }

    const label = isExpanded ? 'Hide submodules' : 'Show submodules'

    return (
      <button
        className="expand-collapse"
        aria-label={label}
        aria-expanded={isExpanded}
        onClick={this.onToggleExpanded}
        onMouseDown={this.onExpandCollapseMouseDown}
      >
        <Octicon
          symbol={isExpanded ? octicons.chevronDown : octicons.chevronRight}
        />
      </button>
    )
  }

  private onExpandCollapseMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    // Expanding a repository shouldn't move the list selection to it
    event.preventDefault()
    event.stopPropagation()
  }

  private onToggleExpanded = (event: React.MouseEvent<HTMLButtonElement>) => {
    const { repository, onToggleExpanded } = this.props

    // Toggling shouldn't select the repository the submodules belong to
    event.preventDefault()
    event.stopPropagation()

    if (repository instanceof Repository) {
      onToggleExpanded?.(repository)
    }
  }

  private renderSubmodule(submodule: ISubmoduleListItemData) {
    const { entry } = submodule
    const { repository } = this.props
    const hasChanges = this.props.changedFilesCount > 0

    return (
      <div className="repository-list-item submodule" ref={this.listItemRef}>
        <Tooltip target={this.listItemRef}>
          {this.renderSubmoduleTooltip(submodule)}
        </Tooltip>

        <div className="expand-collapse-placeholder" />

        <Octicon
          className="icon-for-repository"
          symbol={octicons.fileSubmodule}
        />

        <div className="name">
          <HighlightText
            text={entry.path}
            highlight={this.props.matches.title}
          />
        </div>

        {entry.status === SubmoduleStatus.NotInitialized ? (
          <div className="submodule-state">uninitialized</div>
        ) : (
          <div className="submodule-state">{entry.describe}</div>
        )}

        {repository !== null &&
          renderRepoIndicators({
            aheadBehind: this.props.aheadBehind,
            hasChanges,
          })}
      </div>
    )
  }

  private renderSubmoduleTooltip(submodule: ISubmoduleListItemData) {
    const { entry, parent } = submodule

    return (
      <>
        <div>
          <strong>{entry.path}</strong>
        </div>
        <div>
          {entry.sha} {entry.describe && `(${entry.describe})`}
        </div>
        <div>{describeSubmoduleStatus(entry.status)}</div>
        <div>Submodule of {parent.name}</div>
      </>
    )
  }

  private renderTooltip() {
    const repo = this.props.repository

    if (repo === null) {
      return null
    }

    const gitHubRepo = repo instanceof Repository ? repo.gitHubRepository : null
    const alias = repo instanceof Repository ? repo.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repo.name

    return (
      <>
        <div>
          <strong>{realName}</strong>
          {alias && <> ({alias})</>}
        </div>
        <div>{repo.path}</div>
      </>
    )
  }

  public shouldComponentUpdate(nextProps: IRepositoryListItemProps): boolean {
    if (
      nextProps.repository instanceof Repository &&
      this.props.repository instanceof Repository
    ) {
      return (
        nextProps.repository.id !== this.props.repository.id ||
        nextProps.matches !== this.props.matches ||
        nextProps.isExpanded !== this.props.isExpanded ||
        nextProps.submoduleCount !== this.props.submoduleCount ||
        nextProps.submodule?.entry !== this.props.submodule?.entry
      )
    } else {
      return true
    }
  }
}

const describeSubmoduleStatus = (status: SubmoduleStatus) => {
  switch (status) {
    case SubmoduleStatus.NotInitialized:
      return 'Not initialized'
    case SubmoduleStatus.Modified:
      return "Doesn't match the commit recorded in its parent repository"
    case SubmoduleStatus.Conflicted:
      return 'Has merge conflicts'
    case SubmoduleStatus.UpToDate:
      return 'Matches the commit recorded in its parent repository'
  }
}

const renderRepoIndicators: React.FunctionComponent<{
  aheadBehind: IAheadBehind | null
  hasChanges: boolean
}> = props => {
  return (
    <div className="repo-indicators">
      {props.aheadBehind && renderAheadBehindIndicator(props.aheadBehind)}
      {props.hasChanges && renderChangesIndicator()}
    </div>
  )
}

const renderAheadBehindIndicator = (aheadBehind: IAheadBehind) => {
  const { ahead, behind } = aheadBehind
  if (ahead === 0 && behind === 0) {
    return null
  }

  const aheadBehindTooltip =
    'The currently checked out branch is' +
    (behind ? ` ${commitGrammar(behind)} behind ` : '') +
    (behind && ahead ? 'and' : '') +
    (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
    'its tracked branch.'

  return (
    <TooltippedContent
      className="ahead-behind"
      tagName="div"
      tooltip={aheadBehindTooltip}
      disabled={enableAccessibleListToolTips()}
    >
      {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
      {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
    </TooltippedContent>
  )
}

const renderChangesIndicator = () => {
  return (
    <TooltippedContent
      className="change-indicator-wrapper"
      tooltip="There are uncommitted changes in this repository"
      disabled={enableAccessibleListToolTips()}
    >
      <Octicon symbol={octicons.dotFill} />
    </TooltippedContent>
  )
}

export const commitGrammar = (commitNum: number) =>
  `${commitNum} commit${commitNum > 1 ? 's' : ''}` // english is hard

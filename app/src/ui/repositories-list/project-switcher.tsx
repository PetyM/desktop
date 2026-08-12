import * as React from 'react'

import { IProject } from '../../models/project'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IProjectSwitcherProps {
  readonly projects: ReadonlyArray<IProject>
  readonly selectedProject: IProject | null

  /** Called with the project to filter by, or null to show every repository */
  readonly onSelectedProjectChanged: (projectId: number | null) => void

  readonly onCreateProject: () => void
  readonly onRenameProject: (project: IProject) => void
  readonly onDeleteProject: (project: IProject) => void
}

interface IProjectSwitcherState {
  readonly menuExpanded: boolean
}

const AllRepositoriesLabel = __DARWIN__
  ? 'All Repositories'
  : 'All repositories'

/**
 * A button above the repository list which switches between the projects the
 * user has created and lets them manage those projects.
 */
export class ProjectSwitcher extends React.Component<
  IProjectSwitcherProps,
  IProjectSwitcherState
> {
  public constructor(props: IProjectSwitcherProps) {
    super(props)

    this.state = { menuExpanded: false }
  }

  public render() {
    const { selectedProject } = this.props
    const label = selectedProject?.name ?? AllRepositoriesLabel

    return (
      <div className="project-switcher">
        <Button
          className="project-switcher-button"
          onClick={this.onButtonClick}
          ariaExpanded={this.state.menuExpanded}
          ariaLabel={`Project: ${label}`}
        >
          <Octicon symbol={octicons.project} />
          <span className="project-name">{label}</span>
          <Octicon symbol={octicons.triangleDown} />
        </Button>
      </div>
    )
  }

  private onButtonClick = () => {
    const { projects, selectedProject } = this.props

    const items: Array<IMenuItem> = [
      {
        label: AllRepositoriesLabel,
        type: 'checkbox',
        checked: selectedProject === null,
        action: () => this.props.onSelectedProjectChanged(null),
      },
    ]

    if (projects.length > 0) {
      items.push({ type: 'separator' })

      for (const project of projects) {
        items.push({
          label: project.name,
          type: 'checkbox',
          checked: selectedProject?.id === project.id,
          action: () => this.props.onSelectedProjectChanged(project.id),
        })
      }
    }

    items.push(
      { type: 'separator' },
      {
        label: __DARWIN__ ? 'New Project…' : 'New project…',
        action: this.props.onCreateProject,
      }
    )

    if (selectedProject !== null) {
      items.push(
        {
          label: __DARWIN__ ? 'Rename Project…' : 'Rename project…',
          action: () => this.props.onRenameProject(selectedProject),
        },
        {
          label: __DARWIN__ ? 'Delete Project…' : 'Delete project…',
          action: () => this.props.onDeleteProject(selectedProject),
        }
      )
    }

    this.setState({ menuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ menuExpanded: false })
    })
  }
}

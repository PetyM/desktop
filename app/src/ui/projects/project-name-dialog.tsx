import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { IProject } from '../../models/project'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'

interface IProjectNameDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  /** The project being renamed, or undefined when creating a new project */
  readonly project?: IProject

  /** Repository to add to the project once it's been created */
  readonly repository?: Repository
}

interface IProjectNameDialogState {
  readonly name: string
  readonly error: string | null
  readonly isSubmitting: boolean
}

/** Dialog used to create a new project or rename an existing one. */
export class ProjectNameDialog extends React.Component<
  IProjectNameDialogProps,
  IProjectNameDialogState
> {
  public constructor(props: IProjectNameDialogProps) {
    super(props)

    this.state = {
      name: props.project?.name ?? '',
      error: null,
      isSubmitting: false,
    }
  }

  public render() {
    const renaming = this.props.project !== undefined
    const title = renaming
      ? __DARWIN__
        ? 'Rename Project'
        : 'Rename project'
      : __DARWIN__
      ? 'Create a Project'
      : 'Create a project'

    return (
      <Dialog
        id="project-name"
        title={title}
        ariaDescribedBy="project-name-description"
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        disabled={this.state.isSubmitting}
        loading={this.state.isSubmitting}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}

        <DialogContent>
          <p id="project-name-description">
            {renaming
              ? 'Choose a new name for this project.'
              : 'Projects let you group repositories together and switch between those groups in the repository list.'}
          </p>
          <p>
            <TextBox
              ariaLabel="Project name"
              placeholder="Project name"
              autoFocus={true}
              value={this.state.name}
              onValueChanged={this.onNameChanged}
            />
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={
              renaming
                ? __DARWIN__
                  ? 'Rename Project'
                  : 'Rename project'
                : __DARWIN__
                ? 'Create Project'
                : 'Create project'
            }
            okButtonDisabled={this.state.name.trim().length === 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onNameChanged = (name: string) => {
    this.setState({ name, error: null })
  }

  private onSubmit = async () => {
    const { dispatcher, project, repository } = this.props
    const name = this.state.name.trim()

    if (name.length === 0) {
      return
    }

    this.setState({ isSubmitting: true, error: null })

    try {
      if (project !== undefined) {
        await dispatcher.renameProject(project, name)
      } else {
        await dispatcher.createProject(
          name,
          repository !== undefined ? [repository] : []
        )
      }
    } catch (e) {
      this.setState({ isSubmitting: false, error: e.message })
      return
    }

    this.props.onDismissed()
  }
}

import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { IProject } from '../../models/project'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'

interface IDeleteProjectProps {
  readonly dispatcher: Dispatcher
  readonly project: IProject
  readonly onDismissed: () => void
}

interface IDeleteProjectState {
  readonly isDeleting: boolean
}

/** Confirmation shown before a project is deleted. */
export class DeleteProject extends React.Component<
  IDeleteProjectProps,
  IDeleteProjectState
> {
  public constructor(props: IDeleteProjectProps) {
    super(props)

    this.state = { isDeleting: false }
  }

  public render() {
    return (
      <Dialog
        id="delete-project"
        title={__DARWIN__ ? 'Delete Project' : 'Delete project'}
        type="warning"
        onSubmit={this.deleteProject}
        onDismissed={this.props.onDismissed}
        disabled={this.state.isDeleting}
        loading={this.state.isDeleting}
        role="alertdialog"
        ariaDescribedBy="delete-project-confirmation-message"
      >
        <DialogContent>
          <div id="delete-project-confirmation-message">
            <p>
              Delete the project <Ref>{this.props.project.name}</Ref>?
            </p>
            <p>
              The repositories in the project will remain in GitHub Desktop,
              only the grouping is removed.
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Delete" />
        </DialogFooter>
      </Dialog>
    )
  }

  private deleteProject = async () => {
    this.setState({ isDeleting: true })

    await this.props.dispatcher.deleteProject(this.props.project)

    this.props.onDismissed()
  }
}

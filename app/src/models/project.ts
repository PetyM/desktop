/**
 * A user defined grouping of repositories.
 *
 * A repository can be a member of any number of projects and selecting a
 * project in the repository list filters the list down to the repositories
 * belonging to that project.
 */
export interface IProject {
  readonly id: number
  readonly name: string
}

/** Compare two projects by name, for display purposes. */
export function compareProjects(x: IProject, y: IProject) {
  return x.name.localeCompare(y.name, undefined, { sensitivity: 'accent' })
}

/** The state of a submodule as reported by `git submodule status` */
export enum SubmoduleStatus {
  /** The submodule is initialized and matches the commit in the index */
  UpToDate = 'up-to-date',
  /** The submodule is not initialized */
  NotInitialized = 'not-initialized',
  /**
   * The checked out submodule commit does not match the SHA-1 found in the
   * index of the containing repository
   */
  Modified = 'modified',
  /** The submodule has merge conflicts */
  Conflicted = 'conflicted',
}

export class SubmoduleEntry {
  public constructor(
    public readonly sha: string,
    public readonly path: string,
    public readonly describe: string,
    public readonly status: SubmoduleStatus = SubmoduleStatus.UpToDate
  ) {}
}

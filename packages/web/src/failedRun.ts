/**
 * The cue for a run that failed: the canvas keeps the last good picture, dimmed, with the
 * error over it. Only the view; nothing here changes the recipe or the run.
 */
export type FailedRunCue = { dim: boolean; message: string };

export function failedRunCue(run: { error: { message: string } | null; hasPicture: boolean }): FailedRunCue | null {
  if (!run.error) return null;
  return run.hasPicture
    ? { dim: true, message: `This recipe can't run, so this is the last plot that did. ${run.error.message}` }
    : { dim: false, message: `This recipe can't run. ${run.error.message}` };
}

// packages/core/lib/error-handler.mjs

export const ERROR_LEVELS = {
  CRITICAL: 'critical', // VCS fail, architect fail → ABORT
  WARNING: 'warning', // Test fail → CONTINUE_ALERT
  INFO: 'info', // Docs incomplete → CONTINUE
};

export const ERROR_SEVERITY = {
  [ERROR_LEVELS.CRITICAL]: { action: 'ABORT', notify: ['user', 'logs'], rollback: true },
  [ERROR_LEVELS.WARNING]: { action: 'CONTINUE_ALERT', notify: ['agent'], flag: 'review_required' },
  [ERROR_LEVELS.INFO]: { action: 'CONTINUE', notify: ['logger'] },
};

export class PipelineError extends Error {
  constructor(message, level = ERROR_LEVELS.WARNING, context = {}) {
    super(message);
    this.name = 'PipelineError';
    this.level = level;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

export async function handlePipelineError(error, taskName, pipelineState) {
  const severity = ERROR_SEVERITY[error.level] || ERROR_SEVERITY[ERROR_LEVELS.WARNING];

  // Log error
  console.error(`[${error.timestamp}] ${error.level.toUpperCase()} in ${taskName}: ${error.message}`, error.context);

  // Decide action
  if (severity.action === 'ABORT') {
    // Save checkpoint before abort
    await saveCheckpoint(pipelineState, `pre-abort-${taskName}`);
    throw new Error(`Pipeline aborted: ${error.message}`);
  }

  if (severity.action === 'CONTINUE_ALERT') {
    // Flag for review
    pipelineState.issues = pipelineState.issues || [];
    pipelineState.issues.push({
      agent: taskName,
      severity: error.level,
      message: error.message,
      context: error.context,
      requiresReview: true,
    });
  }

  return severity;
}

async function saveCheckpoint(state, name) {
  // TODO: Guardar checkpoint en git (tag vcs/checkpoint-{timestamp})
  console.log(`Checkpoint saved: ${name}`);
}

export default {
  ERROR_LEVELS,
  ERROR_SEVERITY,
  PipelineError,
  handlePipelineError,
};

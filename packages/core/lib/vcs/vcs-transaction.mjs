// packages/core/lib/vcs/vcs-transaction.mjs

export const VCS_TRANSACTION_TYPES = {
  BRANCH_CREATE: 'branch-create',
  CODE_COMMIT: 'code-commit',
  FINAL_MERGE: 'final-merge',
};

export const TRANSACTION_CONFIG = {
  [VCS_TRANSACTION_TYPES.BRANCH_CREATE]: {
    idempotent: true,
    rollback: 'delete branch',
    checkpoint: false,
  },
  [VCS_TRANSACTION_TYPES.CODE_COMMIT]: {
    idempotent: false,
    checkpoint: true,
    rollback: 'revert commit',
  },
  [VCS_TRANSACTION_TYPES.FINAL_MERGE]: {
    idempotent: false,
    checkpoint: true,
    rollback: 'revert merge + recreate branch',
  },
};

export class VCSTransaction {
  constructor(vcsManager) {
    this.vcsManager = vcsManager;
    this.transactions = [];
    this.checkpoints = [];
    this.isRolledBack = false;
  }

  async createCheckpoint(name) {
    const checkpointName = `vcs/checkpoint-${name}-${Date.now()}`;

    try {
      await this.vcsManager.tag(checkpointName, `Pipeline checkpoint: ${new Date().toISOString()}`);
      this.checkpoints.push({
        name: checkpointName,
        timestamp: new Date().toISOString(),
        status: 'created',
      });
      console.log(`Checkpoint created: ${checkpointName}`);
      return checkpointName;
    } catch (error) {
      console.error(`Failed to create checkpoint: ${error.message}`);
      throw error;
    }
  }

  async executeTransactionWithCheckpoint(type, operation) {
    const config = TRANSACTION_CONFIG[type];

    if (!config) {
      throw new Error(`Unknown transaction type: ${type}`);
    }

    // 1. Create checkpoint before transaction if needed
    let checkpoint = null;
    if (config.checkpoint) {
      checkpoint = await this.createCheckpoint(type);
    }

    // 2. Execute transaction
    try {
      const result = await operation();

      this.transactions.push({
        type,
        timestamp: new Date().toISOString(),
        status: 'SUCCESS',
        checkpoint,
        result,
      });

      return result;
    } catch (error) {
      // 3. Rollback if checkpoint exists
      if (checkpoint && config.rollback) {
        await this.rollbackToCheckpoint(checkpoint, config.rollback);
      }

      this.transactions.push({
        type,
        timestamp: new Date().toISOString(),
        status: 'FAILED',
        checkpoint,
        error: error.message,
      });

      throw error;
    }
  }

  async rollbackToCheckpoint(checkpointName, action) {
    console.log(`Rolling back to ${checkpointName}...`);
    console.log(`   Action: ${action}`);

    try {
      // Git: checkout commit associated with tag
      await this.vcsManager.checkout(checkpointName);

      this.isRolledBack = true;
      console.log(`Rollback completed`);
    } catch (error) {
      console.error(`Rollback failed: ${error.message}`);
      throw error;
    }
  }

  getTransactionLog() {
    return {
      transactions: this.transactions,
      checkpoints: this.checkpoints,
      isRolledBack: this.isRolledBack,
    };
  }
}

export default VCSTransaction;

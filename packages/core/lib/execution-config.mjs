// packages/core/lib/execution-config.mjs

export const EXECUTION_TIMEOUTS = {
  perAgent: 30000, // 30 seconds per agent
  perLevel: 120000, // 2 minutes per level
  totalPipeline: 600000, // 10 minutes total
};

export const DEGRADATION_STRATEGY = {
  agents: {
    '@performance': {
      priority: 'low',
      action: 'skip',
      notifyAgent: '@code-review',
      fallback: 'generic performance check',
    },
    '@testing': {
      priority: 'high',
      action: 'ABORT', // Never skip testing
      notifyAgent: null,
    },
    '@documentation': {
      priority: 'low',
      action: 'skip',
      notifyAgent: 'user',
      fallback: 'auto-generated docs',
    },
    '@security': {
      priority: 'critical',
      action: 'ABORT',
      notifyAgent: null,
    },
  },

  onTimeout(agentName, elapsedMs) {
    const config = this.agents[agentName];

    if (!config) {
      return { action: 'CONTINUE' };
    }

    console.warn(`Timeout on ${agentName} after ${(elapsedMs / 1000).toFixed(1)}s`);
    console.log(`   Priority: ${config.priority}`);
    console.log(`   Action: ${config.action}`);

    if (config.action === 'ABORT') {
      throw new Error(`Critical agent timeout: ${agentName}`);
    }

    if (config.action === 'skip') {
      console.log(`   Fallback: ${config.fallback}`);
      return {
        action: 'skip',
        fallback: config.fallback,
        notifyAgent: config.notifyAgent,
      };
    }

    return { action: 'CONTINUE' };
  },
};

export class ExecutionLimiter {
  constructor(timeouts = EXECUTION_TIMEOUTS) {
    this.timeouts = timeouts;
    this.startTime = Date.now();
    this.agentStartTimes = {};
    this.skippedAgents = [];
  }

  startAgent(agentName) {
    this.agentStartTimes[agentName] = Date.now();
  }

  async checkTimeout(agentName) {
    const elapsed = Date.now() - this.agentStartTimes[agentName];

    if (elapsed > this.timeouts.perAgent) {
      const degradation = DEGRADATION_STRATEGY.onTimeout(agentName, elapsed);

      if (degradation.action === 'skip') {
        this.skippedAgents.push({
          agent: agentName,
          reason: 'timeout',
          fallback: degradation.fallback,
        });
      } else if (degradation.action === 'ABORT') {
        throw new Error(`Agent timeout (critical): ${agentName} took ${(elapsed / 1000).toFixed(1)}s`);
      }

      return degradation;
    }

    const totalElapsed = Date.now() - this.startTime;
    if (totalElapsed > this.timeouts.totalPipeline) {
      throw new Error(`Total pipeline timeout: ${(totalElapsed / 1000).toFixed(1)}s exceeded`);
    }

    return { action: 'CONTINUE' };
  }

  getReport() {
    const totalTime = Date.now() - this.startTime;
    return {
      totalExecutionTime: `${(totalTime / 1000).toFixed(1)}s`,
      timeoutLimit: `${(this.timeouts.totalPipeline / 1000).toFixed(1)}s`,
      skippedAgents: this.skippedAgents,
      status: totalTime > this.timeouts.totalPipeline ? 'TIMEOUT' : 'OK',
    };
  }
}

export default {
  EXECUTION_TIMEOUTS,
  DEGRADATION_STRATEGY,
  ExecutionLimiter,
};

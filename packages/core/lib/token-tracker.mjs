// packages/core/lib/token-tracker.mjs

export class TokenTracker {
  constructor(initialBudget = 190000) {
    this.initialBudget = initialBudget;
    this.used = 0;
    this.remaining = initialBudget;
    this.byAgent = {};
    this.trace = [];
    this.warnings = [];
  }

  trackAgentCall(agentName, tokensUsed) {
    this.used += tokensUsed;
    this.remaining = this.initialBudget - this.used;

    // Track per agent
    if (!this.byAgent[agentName]) {
      this.byAgent[agentName] = 0;
    }
    this.byAgent[agentName] += tokensUsed;

    // Track execution trace
    this.trace.push({
      ts: new Date().toISOString(),
      agent: agentName,
      tokens: tokensUsed,
      remaining: this.remaining,
      percentage: ((this.used / this.initialBudget) * 100).toFixed(1),
    });

    // Warning if exceeding expected percentage
    const expectedPercent = 10; // 10% per major agent
    const actualPercent = (this.byAgent[agentName] / this.initialBudget) * 100;
    if (actualPercent > expectedPercent) {
      this.warnings.push({
        agent: agentName,
        expected: expectedPercent,
        actual: actualPercent.toFixed(1),
        message: `${agentName} consumed ${actualPercent.toFixed(1)}% of budget (expected: ${expectedPercent}%)`,
      });
    }

    // Critical warning if <10% remaining
    if (this.remaining / this.initialBudget < 0.1) {
      this.warnings.push({
        level: 'CRITICAL',
        message: `Critical: Only ${((this.remaining / this.initialBudget) * 100).toFixed(1)}% of token budget remaining!`,
      });
    }
  }

  getCompressedContextBlock() {
    return {
      TOKEN_BUDGET: {
        initial: this.initialBudget,
        used: this.used,
        remaining: this.remaining,
        percentageUsed: ((this.used / this.initialBudget) * 100).toFixed(1),
        by_agent: this.byAgent,
        warnings: this.warnings,
      },
      EXECUTION_TRACE: this.trace.slice(-10), // Last 10 entries
    };
  }

  toMarkdown() {
    let md = '## Token Usage Report\n\n';
    md += `**Initial Budget:** ${this.initialBudget.toLocaleString()} tokens\n`;
    md += `**Used:** ${this.used.toLocaleString()} (${((this.used / this.initialBudget) * 100).toFixed(1)}%)\n`;
    md += `**Remaining:** ${this.remaining.toLocaleString()} (${((this.remaining / this.initialBudget) * 100).toFixed(1)}%)\n\n`;

    md += '### By Agent\n';
    for (const [agent, tokens] of Object.entries(this.byAgent)) {
      const percent = ((tokens / this.initialBudget) * 100).toFixed(1);
      md += `- **${agent}**: ${tokens.toLocaleString()} tokens (${percent}%)\n`;
    }

    if (this.warnings.length > 0) {
      md += '\n### Warnings\n';
      for (const warning of this.warnings) {
        md += `- ${warning.message}\n`;
      }
    }

    return md;
  }
}

export default TokenTracker;

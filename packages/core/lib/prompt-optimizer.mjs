// packages/core/lib/prompt-optimizer.mjs

const COMPRESSION_RULES = {
  // 1. Remove boilerplate
  removeBoilerplate: (prompt) => {
    const patterns = [
      /Please help me/gi,
      /I need you to/gi,
      /Can you help me/gi,
      /Would you mind/gi,
      /If possible/gi,
      /Thank you/gi
    ];

    let optimized = prompt;
    for (const pattern of patterns) {
      optimized = optimized.replace(pattern, '');
    }

    return optimized.replace(/\s+/g, ' ').trim();
  },

  // 2. Use structured facts instead of prose
  proseToStructured: (prompt) => {
    // Convert narrative paragraphs to key:value facts
    // "The user wants to add a feature that validates emails in forms"
    // → "Feature: email validation in forms"

    return prompt;
  },

  // 3. Reference file paths instead of quoting
  replaceQuotesWithReferences: (prompt) => {
    return prompt.replace(
      /I found this code:[\s\S]*?function/,
      'Code in src/auth.js:15-42: function'
    );
  },

  // 4. Compress repeated context
  deduplicateContext: (current, previous) => {
    if (!previous) return current;

    // Remove sentences that are similar to previous context
    const prevSentences = previous.split(/[.!?]/);
    const currSentences = current.split(/[.!?]/);

    const newInfo = currSentences.filter(sentence => {
      return !prevSentences.some(prev =>
        similarity(sentence.trim(), prev.trim()) > 0.8
      );
    });

    return newInfo.join('. ').trim();
  }
};

export class PromptOptimizer {
  constructor(rules = COMPRESSION_RULES) {
    this.rules = rules;
  }

  async optimize(prompt, options = {}) {
    const {
      targetReduction = 0.70,    // 70% target
      preserveIntent = true,
      validateSchema = true,
      previousContext = null
    } = options;

    let optimized = prompt;

    // 1. Apply boilerplate removal
    optimized = this.rules.removeBoilerplate(optimized);

    // 2. Compress repeated context
    if (previousContext) {
      optimized = this.rules.deduplicateContext(optimized, previousContext);
    }

    // 3. Validate compression ratio
    const ratio = optimized.length / prompt.length;
    if (ratio > (1 - targetReduction)) {
      console.warn(`Compression ratio ${(ratio * 100).toFixed(1)}% exceeds target ${(targetReduction * 100).toFixed(1)}%`);
    }

    return {
      original: prompt,
      optimized,
      ratio: ratio,
      savings: prompt.length - optimized.length,
      targetAchieved: ratio <= (1 - targetReduction)
    };
  }
}

function similarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(str1, str2) {
  const costs = new Array(str2.length + 1).fill(0);

  for (let i = 0; i <= str1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= str2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (str1.charAt(i - 1) !== str2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[str2.length] = lastValue;
  }

  return costs[str2.length];
}

export default PromptOptimizer;

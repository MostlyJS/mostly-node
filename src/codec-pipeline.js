class CodecPipeline {
  constructor () {
    this._stack = [];
    return this;
  }

  add (step) {
    this._stack.push(step);
    return this;
  }

  /**
   * Reset the stack and add optionally an element
   */
  reset (step) {
    this._stack = step? [step] : [];
    return this;
  }

  /**
   * Add the element at the beginning of the stack
   */
  first (step) {
    this._stack.unshift(step);
    return this;
  }

  /**
   * Accumulate value
   */
  run (msg, ctx) {
    let firstError = null;

    const value = this._stack.reduce((data, item, index) => {
      const result = item.call(ctx, data);
      if (!firstError && result.error) {
        firstError = result.error;
      }
      return result.value;
    }, msg);

    return { value, error: firstError };
  }
}

module.exports = CodecPipeline;
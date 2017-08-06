import EventEmitter from 'events';

/**
 * Based on https://docs.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
 * 
 * A circuit breaker acts as a proxy as a state machine for operations that might fail. 
 * 
 * @class CircuitBreaker
 * @extends {EventEmitter}
 */
export default class CircuitBreaker extends EventEmitter {
  constructor (options) {
    super();

    // states
    this.CIRCUIT_CLOSE = 'close';
    this.CIRCUIT_HALF_OPEN = 'half_open';
    this.CIRCUIT_OPEN = 'open';

    // intial state
    this._state = this.CIRCUIT_CLOSE;
    // current fauilures
    this._failureCount = 0;
    // successes count
    this._successesCount = 0;
    // max failure threshold
    this._maxFailures = options.maxFailures;
    // min successes to close the circuit breaker
    this._minSuccesses = options.minSuccesses;
    // the timeout when the circuit breaker in in half open state
    this._halfOpenTime = options.halfOpenTime;
    // interval when the circuit breaker will reset
    this._resetIntervalTime = options.resetIntervalTime;
    // half open timer
    this._failureTimer = null;
  }

  get state () {
    return this._state;
  }

  /**
   *  The failure counter used by the Closed state is time based. It's automatically reset at periodic intervals.
   *  This helps to prevent the circuit breaker from entering the Open state if it experiences occasional failures
   */
  startResetInterval () {
    this._resetInterval = setInterval(() => {
      this._state = this.CIRCUIT_CLOSE;
      this._failureCount = 0;
    }, this._resetIntervalTime);
  }

  clearHalfOpenTimer () {
    if (this._halfOpenTime) {
      clearTimeout(this._halfOpenTime);
      this._halfOpenTime = null;
    }
  }

  startHalfOpenTimer () {
    // avoid starting new timer when existing already ticks
    if (!this._halfOpenTimer) {
      this._halfOpenTimer = setTimeout(() => {
        this._successesCount = 0;
        this._state = this.CIRCUIT_HALF_OPEN;
      }, this._halfOpenTime);
      // unref from event loop
      this._halfOpenTimer.unref();
    }
  }

  clearResetInterval () {
    if (this._resetInterval) {
      clearInterval(this._resetInterval);
    }
  }

  toJSON () {
    return {
      state: this._state,
      failures: this._failureCount,
      successes: this._successesCount
    };
  }

  available () {
    return this._state !== this.CIRCUIT_OPEN;
  }

  success () {
    this.record(true);
  }

  failure () {
    this.record(false);
  }

  record (success) {
    if (this._state === this.CIRCUIT_HALF_OPEN) {
      // The counter used by the Half-Open state records the number of successful attempts to invoke the operation.
      // The circuit breaker reverts to the Closed state after a specified number of consecutive operation invocations have been successful.
      if (success === true) {
        if (this._successesCount >= this._minSuccesses) {
          this._state = this.CIRCUIT_CLOSE;
          // reset failure count and clear half-open timeout
          this._failureCount = 0;
          this.clearHalfOpenTimer();
          this.emit('stateChange', this.toJSON());
        }
        // request was successfully we increment it
        this._successesCount += 1;
        // this.emit('success', this.toJSON());
      } else if (success === false) {
        // If any invocation fails, the circuit breaker enters the Open state immediately and
        // the success counter will be reset the next time it enters the Half-Open state.
        this._state = this.CIRCUIT_OPEN;
        this.clearHalfOpenTimer();
        this.emit('stateChange', this.toJSON());
      }
    } else if (this._state === this.CIRCUIT_OPEN) {
      this._failureCount = 0;
      // At this point the proxy starts a timeout timer
      // and when this timer expires the proxy is placed into the Half-Open state.
      // before we enter the Half-open state we reset the successes count
      this._successesCount = 0;
      this.startHalfOpenTimer();
      this.emit('stateChange', this.toJSON());
    } else if (this._state === this.CIRCUIT_CLOSE) {
      if (success === false) {
        // when request fails we increment the failureCount
        this._failureCount += 1;
        // this.emit('failure', this.toJSON());
      }

      // when we reach maximum failure threshold we open the circuit breaker and start the reset timer
      if (this._failureCount >= this._maxFailures) {
        this._state = this.CIRCUIT_OPEN;
        this.clearResetInterval(this._resetInterval);
        this.startResetInterval();
        this.emit('stateChange', this.toJSON());
      }
    }
  }
}
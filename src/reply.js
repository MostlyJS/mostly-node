'use strict';

class Reply {
  constructor (request, response, extensionCallback) {
    this._request = request;
    this._response = response;
    this.extensionCallback = extensionCallback;
  }

  set payload (value) {
    this._response.payload = value;
  }

  get payload () {
    return this._response.payload;
  }

  set error (value) {
    this._response.error = value;
  }

  get error () {
    return this._response.error;
  }

  /**
   * Abort the current request and respond wih the passed value
   */
  end (value) {
    if (value instanceof Error) {
      this.extensionCallback(value);
    } else {
      this.extensionCallback(null, value, true);
    }
  }

  /**
   * Runs through all extensions and keep the passed value to respond it
   */
  send (value) {
    if (value instanceof Error) {
      this.extensionCallback(value);
    } else {
      this.extensionCallback(null, value);
    }
  }
}

module.exports = Reply;
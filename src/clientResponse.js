'use strict';

class ClientResponse {

  constructor () {
    this._response = {};
  }

  get payload () {
    return this._response.value;
  }

  set payload (value) {
    this._response.value = value;
  }

  set error (error) {
    this._response.error = error;
  }

  get error () {
    return this._response.error;
  }

}

module.exports = ClientResponse;
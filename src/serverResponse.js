import _ from 'lodash';

export default class ServerResponse {

  constructor () {
    this._response = {};
  }

  end (value) {
    if (value instanceof Error) {
      if (_.isFunction(this.next)) {
        this.next(value);
      }
    } else {
      if (_.isFunction(this.next)) {
        this.next(null, value, true);
      }
    }
  }

  send (value) {
    if (value instanceof Error) {
      if (_.isFunction(this.next)) {
        this.next(value);
      }
    } else {
      if (_.isFunction(this.next)) {
        this.next(null, value);
      }
    }
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

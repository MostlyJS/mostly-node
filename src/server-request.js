class ServerRequest {

  constructor (payload) {
    this._request = {};
    this._locals = {};
    this.payload = payload;
  }

  get payload () {
    return this._request.value;
  }

  get locals () {
    return this._locals;
  }

  get error () {
    return this._request.error;
  }

  set payload (value) {
    this._request.value = value;
  }

  set error (error) {
    this._request.error = error;
  }
}

module.exports = ServerRequest;


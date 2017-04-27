export default class ClientRequest {

  constructor () {
    this._request = {}
  }

  get payload () {
    return this._request.value
  }

  get error () {
    return this._request.error
  }

  set payload (value) {
    this._request.value = value
  }


  set error (error) {
    this._request.error = error
  }

}


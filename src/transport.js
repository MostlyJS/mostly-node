export default class NatsTransport {

  constructor (params) {
    this.nc = params.transport;
  }

  get driver () {
    return this.nc;
  }

  timeout () {
    return this.nc.timeout.apply(this.nc, arguments);
  }

  send () {
    return this.nc.publish.apply(this.nc, arguments);
  }

  close () {
    return this.nc.close.apply(this.nc, arguments);
  }

  subscribe () {
    return this.nc.subscribe.apply(this.nc, arguments);
  }

  unsubscribe () {
    return this.nc.unsubscribe.apply(this.nc, arguments);
  }

  sendRequest () {
    return this.nc.request.apply(this.nc, arguments);
  }
}

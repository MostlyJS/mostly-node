const _ = require('lodash')

export default class Add {

  constructor (actMeta) {
    this.actMeta = actMeta
    this.actMeta.middleware = actMeta.middleware || []
  }

  use (handler) {
    if (_.isArray(handler)) {
      this.actMeta.middleware = this.actMeta.middleware.concat(handler)
    } else {
      this.actMeta.middleware.push(handler)
    }
    return this
  }

  end (cb) {
    this.actMeta.action = cb
  }

  get middleware () {
    return this.actMeta.middleware
  }

  get schema () {
    return this.actMeta.schema
  }

  get pattern () {
    return this.actMeta.pattern
  }

  set action (action) {
    this.actMeta.action = action
  }

  get action () {
    return this.actMeta.action
  }

  get plugin () {
    return this.actMeta.plugin
  }

}

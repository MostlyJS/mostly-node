import _ from 'lodash';
import Co from 'co';
import Util from './util';

export default class Add {

  constructor (actMeta, options) {
    this.actMeta = actMeta;
    this.options = options;
    this.actMeta.middleware = actMeta.middleware || [];
  }

  _use (handler) {
    this.actMeta.middleware.push(Util.toPromiseFact(handler));
  }

  use (handler) {
    if (_.isArray(handler)) {
      handler.forEach(h => this._use(h));
    } else {
      this._use(handler);
    }
    return this;
  }

  end (cb) {
    this.actMeta.action = cb;
  }

  dispatch (request, response, cb) {
    Util.serial(this.middleware, (item, next) => {
      item(request, response, next);
    }, cb);
  }

  get middleware () {
    return this.actMeta.middleware;
  }

  get schema () {
    return this.actMeta.schema;
  }

  get pattern () {
    return this.actMeta.pattern;
  }

  set action (action) {
    if (Util.isGeneratorFunction(action)) {
      this.actMeta.action = Co.wrap(action);
      this.isPromisable = true;
    } else if (Util.isAsyncFunction(action)) {
      this.actMeta.action = action;
      this.isPromisable = true;
    } else {
      this.actMeta.action = action;
      this.isPromisable = false;
    }
  }

  get action () {
    return this.actMeta.action;
  }

  get plugin () {
    return this.actMeta.plugin;
  }

}

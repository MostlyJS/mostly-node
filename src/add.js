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
    if (this.options.generators && Util.isGeneratorFunction(handler)) {
      this.actMeta.middleware.push(function () {
        // -1 because (req, res, next)
        const next = arguments[arguments.length - 1];
        return Co(handler.apply(this, arguments)).then(x => next(null, x)).catch(next);
      });
    } else {
      this.actMeta.middleware.push(handler);
    }
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

  invokeMiddleware (request, response, cb) {
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
    if (this.options.generators && Util.isGeneratorFunction(action)) {
      this.actMeta.action = Co.wrap(action);
      this.isGenFunc = true;
    } else {
      this.actMeta.action = action;
    }
  }

  get action () {
    return this.actMeta.action;
  }

  get plugin () {
    return this.actMeta.plugin;
  }

}

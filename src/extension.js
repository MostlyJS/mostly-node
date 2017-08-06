import _ from 'lodash';
import Reply from './reply';
import Util from './util';

export default class Extension {

  constructor (type) {
    this._stack = [];
    this._type = type;
  }

  _add (handler) {
    this._stack.push(Util.toPromiseFact(handler));
  }

  add (handler) {
    if (_.isArray(handler)) {
      handler.forEach(h => this._add(h));
    } else {
      this._add(handler);
    }
  }

  addRange (handlers) {
    this._stack = this._stack.concat(handlers);
  }

  /*
   * Executes the stack of callbacks and set the correct
   * response and request context
   */
  dispatch (ctx, cb) {
    const each = (item, next, prevValue, i) => {
      if (ctx._isServer) {
        const response = ctx._response;
        const request = ctx._request;
        const reply = new Reply(request, response, next);

        item(ctx, request, reply, next);
      } else {
        item(ctx, next);
      }
    };

    Util.serialWithCancellation(this._stack, each, cb);
  }

  // unused function
  static parallel (array, method, callback) {
    if (!array.length) {
      callback();
    } else {
      let count = 0;
      let abort = false;
      let errored = false;

      const done = function (err, value, cancel) {
        if (!errored && !abort) {
          if (err) {
            errored = true;
            callback(err);
          } else if (value && cancel) {
            abort = true;
            callback(null, value);
          } else {
            count = count + 1;
            if (count === array.length) {
              callback(null, value);
            }
          }
        }
      };

      for (let i = 0; i < array.length; ++i) {
        method(array[i], done, i);
      }
    }
  }

  // unused function
  static serial (array, method, callback) {
    if (!array.length) {
      callback();
    } else {
      let i = 0;

      const iterate = function iterate(prevValue) {
        const done = function (err, value, abort) {
          if (err) {
            callback(err);
          } else if (value && abort) {
            callback(null, value);
          } else {
            i = i + 1;

            if (i < array.length) {
              iterate(value);
            } else {
              callback(null, value);
            }
          }
        };

        method(array[i], done, prevValue, i);
      };

      iterate();
    }
  }
}

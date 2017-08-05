import co from 'co';
import isGeneratorFn from 'is-generator-function';

export default class Extension {

  constructor (type, options) {
    this._stack = [];
    this._type = type;
    this._options = options;
  }

  add (handler) {
    if (this._options.generators && isGeneratorFn(handler)) {
      this._stack.push(function () {
        // -3 because (req, res, next, prevValue, index)
        const next = arguments[arguments.length - 3];
        return co(handler.apply(this, arguments)).then(x => next(null, x)).catch(next);
      });
    } else {
      this._stack.push(handler);
    }
  }

  addRange (handlers) {
    this._stack = this._stack.concat(handlers);
  }

  invoke (ctx, cb) {
    const each = (item, next, prevValue, i) => {
      if (this._options.server) {
        const response = ctx._response;
        const request = ctx._request;
        // pass next handler to response object so can abort with msg or error
        response.next = next;

        item.call(ctx, request, response, next, prevValue, i);
      } else {
        item.call(ctx, next, i);
      }
    };

    Extension.serial(this._stack, each, cb.bind(ctx));
  }

  /**
   * deprecated, unused function
   *
   * @param {any} array
   * @param {any} method
   * @param {any} callback
   *
   * @memberOf Extension
   */
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

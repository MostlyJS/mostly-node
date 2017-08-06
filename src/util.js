import _ from 'lodash';
import Co from 'co';

const lut = [];
for (let i = 0; i < 256; i++) { lut[i] = (i < 16 ? '0' : '') + (i).toString(16); }

export default class Util {

  static natsWildcardToRegex (subject) {
    let hasTokenWildcard = subject.indexOf('*') > -1;
    let hasFullWildcard = subject.indexOf('>') > -1;

    if (hasFullWildcard) {
      subject = subject.replace('>', '[a-zA-Z0-9\\-\\.]+');
      return new RegExp('^' + subject + '$', 'i');
    } else if (hasTokenWildcard) {
      subject = subject.replace('*', '[a-zA-Z0-9\\-]+');
      return new RegExp('^' + subject + '$', 'i');
    }

    return subject;
  }

  /**
   * Convert a generator or async function
   * to promise factory function and call the last
   * argument as callback
   *
   * @static
   * @param {any} handler
   * @memberof Util
   */
  static toPromiseFact (handler) {
    // -1 because (req, res, next)
    const next = arguments[arguments.length - 1];
    if (Util.isGeneratorFunction(handler)) {
      return Co(handler.apply(this, arguments))
        .then(x => next(null, x))
        .catch(next);
    } else if (Util.isAsyncFunction(handler)) {
      return handler.apply(this, arguments)
        .then(x => next(null, x))
        .catch(next);
    } else {
      return handler;
    }
  }

  // Fast ID generator: e7 https://jsperf.com/uuid-generator-opt/18
  static randomId () {
    const d0 = Math.random() * 0xffffffff | 0;
    const d1 = Math.random() * 0xffffffff | 0;
    const d2 = Math.random() * 0xffffffff | 0;
    const d3 = Math.random() * 0xffffffff | 0;
    return lut[d0 & 0xff] + lut[d0 >> 8 & 0xff] + lut[d0 >> 16 & 0xff] + lut[d0 >> 24 & 0xff] +
      lut[d1 & 0xff] + lut[d1 >> 8 & 0xff] + lut[d1 >> 16 & 0x0f | 0x40] + lut[d1 >> 24 & 0xff] +
      lut[d2 & 0x3f | 0x80] + lut[d2 >> 8 & 0xff] + lut[d2 >> 16 & 0xff] + lut[d2 >> 24 & 0xff] +
      lut[d3 & 0xff] + lut[d3 >> 8 & 0xff] + lut[d3 >> 16 & 0xff] + lut[d3 >> 24 & 0xff];
  }

  static serial (array, method, callback) {
    if (!array.length) {
      callback();
    } else {
      let i = 0;
      const iterate = function () {
        const done = function (err) {
          if (err) {
            callback(err);
          } else {
            i = i + 1;
            if (i < array.length) {
              iterate();
            } else {
              callback();
            }
          }
        };

        method(array[i], done, i);
      };

      iterate();
    }
  }


  /**
   * Executes a series of callbacks and allows to interrupt
   * as well as to continue with a final value
   *
   * @param {Array<Function>} array
   * @param {Function} method
   * @param {Function} callback
   */
  static serialWithCancellation(array, method, callback) {
    if (!array.length) {
      callback();
    } else {
      let i = 0;

      const iterate = function () {
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

        method(array[i], done);
      };

      iterate();
    }
  }

  /**
   * Get high resolution time in nanoseconds
   */
  static nowHrTime () {
    const hrtime = process.hrtime();
    return Math.floor(hrtime[0] * 1000000 + hrtime[1] / 1000);
  }

  static extractSchema (obj) {
    if (obj === null) return obj;

    return _.pickBy(obj, function (val, prop) {
      return _.isObject(val);
    });
  }

  static cleanPattern (obj) {
    if (obj === null) return obj;

    return _.pickBy(obj, function (val, prop) {
      return !_.includes(prop, '$') && !_.isObject(val);
    });
  }

  static cleanFromSpecialVars (obj) {
    if (obj === null) return obj;

    return _.pickBy(obj, function (val, prop) {
      return !_.includes(prop, '$');
    });
  }

  static pattern (args) {
    if (_.isString(args)) {
      return args;
    }

    args = args || {};
    let sb = [];
    _.each(args, function (v, k) {
      if (!~k.indexOf('$') && !_.isFunction(v) && !_.isObject(v)) {
        sb.push(k + ':' + v);
      }
    });

    sb.sort();

    return sb.join(',');
  }

  static isGeneratorFunction (obj) {
    var constructor = obj.constructor;
    if (!constructor) return false;
    if (constructor.name === 'GeneratorFunction' || constructor.displayName === 'GeneratorFunction') return true;
    return false;
  }

  static isAsyncFunction (obj) {
    var constructor = obj.constructor;
    if (!constructor) return false;
    if (constructor.name === 'AsyncFunction' || constructor.displayName === 'AsyncFunction') return true;
    return false;
  }
}

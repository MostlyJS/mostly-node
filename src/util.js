import _ from 'lodash';

const lut = [];
for (let i = 0; i < 256; i++) { lut[i] = (i < 16 ? '0' : '') + (i).toString(16); }

export default class Util {

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
      if (!~k.indexOf('$') && !_.isFunction(v) && typeof(v) !== 'object') {
        sb.push(k + ':' + v);
      }
    });

    sb.sort();

    return sb.join(',');
  }

  static isGenerator (obj) {
    return typeof obj.next === 'function' && typeof obj.throw === 'function';
  }

  static isGeneratorFunction (obj) {
    var constructor = obj.constructor;
    if (!constructor) return false;
    if (constructor.name === 'GeneratorFunction' || constructor.displayName === 'GeneratorFunction') return true;
    return Util.isGenerator(constructor.prototype);
  }
}

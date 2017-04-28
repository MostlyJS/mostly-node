import _ from 'lodash';

const ID_LENGTH = 16
const ID_DIGITS = '0123456789abcdef'

export default class Util {

  static randomId () {
    let n = ''
    for (let i = 0; i < ID_LENGTH; i++) {
      const rand = Math.floor(Math.random() * ID_DIGITS.length)

      // avoid leading zeroes
      if (rand !== 0 || n.length > 0) {
        n += ID_DIGITS[rand]
      }
    }
    return n
  }

  static serial (array, method, callback) {
    if (!array.length) {
      callback()
    } else {
      let i = 0
      const iterate = function () {
        const done = function (err) {
          if (err) {
            callback(err)
          } else {
            i = i + 1
            if (i < array.length) {
              iterate()
            } else {
              callback()
            }
          }
        }

        method(array[i], done, i)
      }

      iterate()
    }
  }

  /**
   * Get high resolution time in nanoseconds
   */
  static nowHrTime () {
    const hrtime = process.hrtime()
    return Math.floor(hrtime[0] * 1000000 + hrtime[1] / 1000)
  }

  static extractSchema (obj) {
    if (obj === null) return obj

    return _.pickBy(obj, function (val, prop) {
      return _.isObject(val)
    })
  }

  static cleanPattern (obj) {
    if (obj === null) return obj

    return _.pickBy(obj, function (val, prop) {
      return !_.includes(prop, '$') && !_.isObject(val)
    })
  }

  static cleanFromSpecialVars (obj) {
    if (obj === null) return obj

    return _.pickBy(obj, function (val, prop) {
      return !_.includes(prop, '$')
    })
  }

  static pattern (args) {
    if (_.isString(args)) {
      return args
    }

    args = args || {}
    let sb = []
    _.each(args, function (v, k) {
      if (!~k.indexOf('$') && !_.isFunction(v)) {
        sb.push(k + ':' + v)
      }
    })

    sb.sort()

    return sb.join(',')
  }
}

const SafeStringify = require('fast-safe-stringify')

export default class Encoder {

  static encode (msg) {
    try {
      return {
        value: SafeStringify(msg)
      }
    } catch (error) {
      return {
        error
      }
    }
  }
}

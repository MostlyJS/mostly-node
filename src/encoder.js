const SafeStringify = require('fast-safe-stringify');

class Encoder {

  static encode (msg) {
    try {
      return {
        value: SafeStringify(msg)
      };
    } catch (error) {
      return { error };
    }
  }
}

module.exports = Encoder;
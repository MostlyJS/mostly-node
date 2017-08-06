if (!global._babelPolyfill) { require('babel-polyfill'); }

module.exports = require('./lib/index');
module.exports.checkPlugin = require('./lib/checkPlugin');

if (!global._babelPolyfill) { require('babel-polyfill'); }

module.exports = require('./lib/index');
module.exports.plugin = require('./lib/plugin');

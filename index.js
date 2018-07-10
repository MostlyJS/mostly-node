console.time('import mostly-node');
module.exports = require("./src/index");
module.exports.checkPlugin = require('./src/checkPlugin');
module.exports.Errors = require('./src/errors');
console.timeEnd('import mostly-node');

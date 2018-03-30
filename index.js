require = require("esm")(module/*, options*/);
module.exports = require("./src/index").default;
module.exports.checkPlugin = require('./src/checkPlugin').default;
module.exports.Errors = require('./src/errors').default;
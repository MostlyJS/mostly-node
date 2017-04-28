const SuperError = require('super-error')

const MostlyError = SuperError.subclass('MostlyError')
const ParseError = MostlyError.subclass('ParseError')
const TimeoutError = MostlyError.subclass('TimeoutError')
const ImplementationError = MostlyError.subclass('ImplementationError')
const BusinessError = MostlyError.subclass('BusinessError')
const FeathersError = MostlyError.subclass('FeathersError')
const FatalError = MostlyError.subclass('FatalError')
const PatternNotFound = MostlyError.subclass('PatternNotFound')
const PayloadValidationError = SuperError.subclass('PayloadValidationError')

module.exports = {
  MostlyError,
  ParseError,
  TimeoutError,
  ImplementationError,
  BusinessError,
  FeathersError,
  FatalError,
  PatternNotFound,
  PayloadValidationError
}

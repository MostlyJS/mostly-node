const SuperError = require('super-error');

const MostlyError = SuperError.subclass('MostlyError');
const ParseError = MostlyError.subclass('ParseError');
const TimeoutError = MostlyError.subclass('TimeoutError');
const ImplementationError = MostlyError.subclass('ImplementationError');
const BusinessError = MostlyError.subclass('BusinessError');
const FeathersError = MostlyError.subclass('FeathersError');
const FatalError = MostlyError.subclass('FatalError');
const PatternNotFound = MostlyError.subclass('PatternNotFound');
const MaxRecursionError = MostlyError.subclass('MaxRecursionError');
const PayloadValidationError = MostlyError.subclass('PayloadValidationError');
const CircuitBreakerError = MostlyError.subclass('CircuitBreakerError');

module.exports = {
  MostlyError,
  MaxRecursionError,
  ParseError,
  TimeoutError,
  ImplementationError,
  BusinessError,
  FeathersError,
  FatalError,
  PatternNotFound,
  PayloadValidationError,
  CircuitBreakerError
};

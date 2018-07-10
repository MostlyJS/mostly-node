'use strict';

function inbound (ctx) {
  return {
    id: ctx.request$.id,
    duration: (ctx.request$.duration / 1e6).toFixed(2) + 'ms',
    pattern: ctx.request$.method
  };
}

function outbound (ctx) {
  return {
    id: ctx._message.request.id,
    pattern: ctx.trace$.method
  };
}

module.exports = {
  inbound,
  outbound
};

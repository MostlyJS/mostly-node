export function inbound (ctx) {
  return {
    id: ctx.request$.id,
    duration: ctx.request$.duration / 1000000,
    pattern: ctx.request$.method
  }
}

export function outbound (ctx) {
  return {
    id: ctx._message.request.id,
    pattern: ctx.trace$.method
  }
}

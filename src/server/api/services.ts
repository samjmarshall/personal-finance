// tRPC composition root: each domain service is built once, here, and reaches
// procedures as `ctx.services`. `next build` loads this module, so no service
// may throw on a missing env var when it is built.
export const services = {};

export type Services = typeof services;

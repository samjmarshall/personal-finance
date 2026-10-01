// One instance per service, shared by every request. The build loads this
// file, so no service may throw on a missing env var.
export const services = {};

export type Services = typeof services;

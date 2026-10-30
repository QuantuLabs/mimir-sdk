const sealed = new WeakSet<object>();

export function sealMimirBetaExpiredObservation<T extends object>(observation: T): Readonly<T> {
  sealed.add(Object.freeze(observation));
  return observation;
}

export function isSealedMimirBetaExpiredObservation(observation: object): boolean {
  return sealed.has(observation);
}

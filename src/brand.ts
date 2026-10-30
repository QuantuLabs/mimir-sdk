/** `instanceof` holds across the ESM copy and the `./beta` browser-bundle copy of a branded class. */
export function brand<T extends abstract new (...args: never[]) => object>(key: string, type: T): T {
  const symbol = Symbol.for(key);
  Object.defineProperty(type.prototype, symbol, { value: true });
  Object.defineProperty(type, Symbol.hasInstance, { value: function (this: T, item: unknown) {
    return typeof item === 'object' && item !== null && (item as Record<symbol, unknown>)[symbol] === true && (this === type || Function.prototype[Symbol.hasInstance].call(this, item));
  } });
  return type;
}

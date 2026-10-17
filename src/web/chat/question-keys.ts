/** The option a number key picks, or undefined: keys 1 to 4 map to the first four options (D-381). */
export function optionForKey<T>(key: string, options: readonly T[]): T | undefined {
  return /^[1-4]$/.test(key) ? options[Number(key) - 1] : undefined;
}

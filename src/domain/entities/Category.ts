/**
 * Watch categories. They drive both the feed configuration and the platform
 * filters of the static site, so the values are part of the data contract.
 */

const Category = {
  REACT_NATIVE: 'react-native',
  TYPESCRIPT: 'typescript',
  IOS: 'ios',
  ANDROID: 'android',
  BACKGROUND: 'background',
  BLE: 'ble',
  HARDWARE: 'hardware',
  TOOLING: 'tooling',
  POLICY: 'policy',
} as const;
type Category = typeof Category[keyof typeof Category];

const ALL_CATEGORIES: readonly Category[] = Object.values(Category);

/** Narrows an arbitrary string to a known category. */
const isCategory = (value: unknown): value is Category => {
  return typeof value === 'string' && ALL_CATEGORIES.some((category) => category === value);
};

export { ALL_CATEGORIES, Category, isCategory };

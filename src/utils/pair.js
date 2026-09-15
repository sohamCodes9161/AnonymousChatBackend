export function sortPair(idA, idB) {
  const a = idA.toString();
  const b = idB.toString();
  return a < b ? [a, b] : [b, a];
}

export function subscribe(list, address) {
  if (!/^[^@]+@[^@]+$/.test(address)) return false;
  list.push(address.toLowerCase());
  return true;
}

let _counter = 0;

export function generateItemUid() {
  _counter += 1;
  const rand = Math.floor(Math.random() * 1679616)
    .toString(36)
    .padStart(4, '0');
  return `itm_${_counter}_${rand}`;
}

export function ensureItemUid(item) {
  if (item && typeof item === 'object' && typeof item.uid !== 'string') {
    item.uid = generateItemUid();
  }
  return item;
}

export function _resetUidCounter() {
  _counter = 0;
}

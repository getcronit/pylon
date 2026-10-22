// A cross-file "row" helper: reads fields off the item it's given.
export function Row(item: any) {
  return item.name + ' ' + item.avatarUrl
}

export function collectionItemMatchesGroup(kind, item, groupKey) {
  if (!groupKey) return true;

  if (kind === "materials") {
    return item?.group === groupKey;
  }

  if (kind === "archive") {
    return (item?.section || "root") === groupKey;
  }

  if (groupKey === "unlabeled") {
    return item?.type == null || item?.type === "";
  }

  return item?.type === groupKey || item?.status === groupKey;
}
